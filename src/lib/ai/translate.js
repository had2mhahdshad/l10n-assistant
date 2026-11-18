'use strict';
// Translation pipeline: mask placeholders → batch AI translate →
// unmask → verify. Batches keep prompts small and retryable.

const { chat, estimateCost } = require('./provider');
const { buildTranslatePrompt } = require('./prompts');
const { maskPlaceholders, unmaskPlaceholders, verifyPlaceholders } = require('../placeholder');

/**
 * Translate a list of entries for ONE target language.
 * @param entries [{ key, value }] — translatable strings only
 * @returns { translations: Map(key -> text), stats, failures: [{key, error}] }
 */
async function translateEntries(entries, opts) {
  const { batchSize = 20, ...promptOpts } = opts;
  const translations = new Map();
  const failures = [];
  const stats = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, model: null, batches: 0 };

  const masked = entries.map((e) => {
    const m = maskPlaceholders(e.value);
    return { key: e.key, masked: m.text, tokens: m.tokens };
  });

  for (let i = 0; i < masked.length; i += batchSize) {
    const batch = masked.slice(i, i + batchSize);
    const items = batch.map((b, j) => ({ id: `${i + j}`, text: b.masked }));
    const messages = buildTranslatePrompt({ ...promptOpts, items });

    try {
      const res = await chat(messages, { json: true });
      stats.batches++;
      stats.promptTokens += res.usage.promptTokens;
      stats.completionTokens += res.usage.completionTokens;
      stats.totalTokens += res.usage.totalTokens;
      stats.costUsd += estimateCost(res.usage, res.model);
      stats.model = res.model;

      let parsed;
      try {
        parsed = JSON.parse(stripCodeFence(res.content));
      } catch {
        throw new Error('AI returned non-JSON output');
      }

      batch.forEach((b, j) => {
        const raw = parsed[`${i + j}`];
        if (typeof raw !== 'string' || !raw.trim()) {
          failures.push({ key: b.key, error: 'empty-or-missing-translation' });
          return;
        }
        const restored = unmaskPlaceholders(raw.trim(), b.tokens);
        const verify = verifyPlaceholders(entries[i + j].value, restored);
        if (!verify.ok && verify.missing.length) {
          // Second chance: keep original placeholders by falling back to
          // source-masked roundtrip so nothing dynamic is ever destroyed.
          const fallback = unmaskPlaceholders(b.masked, b.tokens);
          translations.set(b.key, restored === fallback ? entries[i + j].value : restored);
          failures.push({ key: b.key, error: `placeholder-loss:${verify.missing.join(',')}`, keptTranslation: true });
          return;
        }
        translations.set(b.key, restored);
      });
    } catch (err) {
      for (const b of batch) failures.push({ key: b.key, error: err.message });
    }
  }

  stats.costUsd = Number(stats.costUsd.toFixed(6));
  return { translations, failures, stats };
}

/**
 * Semantic review of translation pairs (Localization Checker).
 * Returns issues[]; on AI failure returns { issues: [], degraded: true }.
 */
async function reviewPairs(pairs, opts) {
  const { buildReviewPrompt } = require('./prompts');
  const messages = buildReviewPrompt({ ...opts, pairs });
  try {
    const res = await chat(messages, { json: true });
    const parsed = JSON.parse(stripCodeFence(res.content));
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    return {
      issues: issues.map((it, idx) => ({
        id: `ai-${idx + 1}`,
        source: 'ai',
        issueType: ['semantic_error', 'grammar', 'unnatural', 'terminology'].includes(it.issueType) ? it.issueType : 'semantic_error',
        severity: ['high', 'medium', 'low'].includes(it.severity) ? it.severity : 'low',
        sourceText: pairs.find((p) => String(p.id) === String(it.id))?.source || null,
        currentTranslation: pairs.find((p) => String(p.id) === String(it.id))?.translation || null,
        suggestion: it.suggestionDirection || it.reason || null,
        reason: it.reason || null,
        pageUrl: pairs.find((p) => String(p.id) === String(it.id))?.pageUrl || null,
      })),
      degraded: false,
      usage: res.usage,
    };
  } catch (err) {
    return { issues: [], degraded: true, error: err.message };
  }
}

function stripCodeFence(s) {
  return String(s).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

module.exports = { translateEntries, reviewPairs, stripCodeFence };
