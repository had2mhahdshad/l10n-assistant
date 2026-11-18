'use strict';
// Quality checks for the AI Translation workspace.
// Programmatic checks run here; semantic/naturalness review uses the AI
// service via checker pipeline when requested.

const { verifyPlaceholders, verifyHtml, verifyUrls } = require('./placeholder');
const { detectLanguage } = require('./languageDetect');
const { verifyStructure } = require('./jsonParser');

/**
 * Run per-entry QA for one locale.
 * @param entries [{ key, sourceText, translatedText }]
 * @returns issues [{ entryKey, issueType, severity, description, suggestion }]
 */
function checkEntries(entries, { targetLang, glossary = [] } = {}) {
  const issues = [];
  const norm = (l) => (l || '').toLowerCase().split('-')[0];
  const tgt = norm(targetLang);

  const byTranslation = new Map();
  for (const e of entries) {
    const t = (e.translatedText || '').trim();
    if (t) {
      if (!byTranslation.has(t)) byTranslation.set(t, []);
      byTranslation.get(t).push(e.key);
    }

    if (!t) {
      issues.push(mk(e.key, 'empty_translation', 'high', 'Translation is empty.', 'Re-translate or fill manually.'));
      continue;
    }

    const vph = verifyPlaceholders(e.sourceText, e.translatedText);
    if (!vph.ok) {
      issues.push(mk(e.key, 'placeholder', 'high',
        vph.missing.length ? `Lost variables: ${vph.missing.join(', ')}` : `Unexpected variables: ${vph.extra.join(', ')}`,
        'Restore the exact placeholder tokens from the source.'));
    }

    const vh = verifyHtml(e.sourceText, e.translatedText);
    if (!vh.ok) {
      issues.push(mk(e.key, 'html_integrity', 'high', 'HTML tag structure differs from source.', 'Match the source tag sequence exactly.'));
    }

    const vu = verifyUrls(e.sourceText, e.translatedText);
    if (!vu.ok) {
      issues.push(mk(e.key, 'url_change', 'medium', `URL changed: ${[...vu.changed, ...vu.added].join(', ')}`, 'Keep URLs identical unless intentionally localized.'));
    }

    // Language sanity: translation should be detectable as target language.
    const d = detectLanguage(e.translatedText);
    if (d.lang !== 'unknown' && tgt && d.lang !== tgt && d.confidence >= 0.6 && e.translatedText.trim().split(/\s+/).length >= 2) {
      // en→de/fr etc: latin-script false positives happen; only flag when
      // the detected language equals the SOURCE language family mismatch
      if (!(tgt === 'zh' && d.lang === 'en')) {
        issues.push(mk(e.key, 'language_mismatch', 'medium', `Detected language looks like "${d.lang}" instead of "${tgt}".`, 'Verify the translation is in the correct language.'));
      }
    }

    // UI length risk estimate
    const width = (s) => [...String(s)].reduce((w, c) => w + (/[⺀-鿿豈-﫿＀-￯]/.test(c) ? 2 : 1), 0);
    const ratio = width(e.translatedText) / Math.max(1, width(e.sourceText));
    const shortKey = /(button|cta|label|menu|nav|title|tab)/i.test(e.key);
    if ((shortKey && ratio > 1.3) || ratio > 1.8) {
      issues.push(mk(e.key, 'ui_length', 'low', `Estimated ${Math.round(ratio * 100)}% of source width (risk estimate, not a render test).`, 'Shorten if this appears in a compact UI element.'));
    }

    // Glossary enforcement
    for (const g of glossary) {
      if (e.sourceText.toLowerCase().includes(g.sourceTerm.toLowerCase()) &&
          !e.translatedText.toLowerCase().includes(g.targetTerm.toLowerCase())) {
        issues.push(mk(e.key, 'terminology', 'medium', `Glossary term "${g.sourceTerm}" not rendered as "${g.targetTerm}".`, 'Apply the project glossary.'));
      }
    }
  }

  // Duplicate translations for distinct sources (often copy-paste errors).
  for (const [t, keys] of byTranslation) {
    if (keys.length > 1 && t.split(/\s+/).length >= 2) {
      issues.push(mk(keys.join(', '), 'duplicate_translation', 'low', `${keys.length} different keys share the identical translation.`, 'Verify these are intentionally identical.'));
    }
  }

  return issues;
}

/** Whole-file QA: structure + key counts. */
function checkFile(sourceJson, translatedJson, sourceEntries, translatedEntries) {
  const issues = [];
  const structural = verifyStructure(sourceJson, translatedJson);
  for (const p of structural) {
    issues.push(mk(p.path, `structure_${p.type}`, 'high', JSON.stringify(p), 'Fix the structure so it mirrors the source file.'));
  }
  const srcStrings = sourceEntries.filter((e) => e.type === 'string').length;
  const dstStrings = translatedEntries.filter((e) => e.type === 'string').length;
  if (srcStrings !== dstStrings) {
    issues.push(mk('(file)', 'key_count_mismatch', 'high', `Source has ${srcStrings} strings, translation has ${dstStrings}.`, 'Key count must match exactly.'));
  }
  return issues;
}

function mk(entryKey, issueType, severity, description, suggestion) {
  return { entryKey, issueType, severity, description, suggestion };
}

module.exports = { checkEntries, checkFile };
