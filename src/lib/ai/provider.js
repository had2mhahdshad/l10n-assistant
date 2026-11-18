'use strict';
// Unified AI service. Two providers:
//   - 'openai': any OpenAI-compatible /chat/completions endpoint.
//     API key lives ONLY here on the server.
//   - 'mock': deterministic offline engine for development, demos and tests.
//     Produces structurally valid output without any network access.
//
// Both return { content, usage: {promptTokens, completionTokens, totalTokens}, model, mock }.

const config = require('../../config');
const settings = require('../settings');

/** Effective AI config: env defaults overridable by the admin settings page. */
function ai() {
  try {
    return settings.getAiConfig();
  } catch {
    return { ...config.ai, temperature: 0.2 };
  }
}

// Approximate token counting (≈4 chars/token latin, ≈1.5/token CJK).
function estimateTokens(text) {
  const s = String(text);
  let t = 0;
  for (const ch of s) t += /[⺀-鿿[⺀-鿿豈-﫿]/.test(ch) ? 0.7 : 0.25;
  return Math.max(1, Math.ceil(t));
}

async function chat(messages, { json = false, timeoutMs, maxRetries } = {}) {
  const cfg = ai();
  if (cfg.provider === 'openai') {
    return openaiChat(messages, { json, timeoutMs: timeoutMs ?? cfg.timeoutMs, maxRetries: maxRetries ?? cfg.maxRetries, cfg });
  }
  return mockChat(messages, { json });
}

async function openaiChat(messages, { json, timeoutMs, maxRetries, cfg = ai() } = {}) {
  if (!cfg.apiKey) throw new Error('AI_API_KEY is not configured');
  timeoutMs = timeoutMs ?? cfg.timeoutMs;
  maxRetries = maxRetries ?? cfg.maxRetries;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: cfg.temperature,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`AI provider HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? '';
      const usage = data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
        : { promptTokens: estimateTokens(messages.map((m) => m.content).join('')), completionTokens: estimateTokens(content), totalTokens: 0 };
      if (!usage.totalTokens) usage.totalTokens = usage.promptTokens + usage.completionTokens;
      return { content, usage, model: cfg.model, mock: false };
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) await sleep(500 * (attempt + 1) ** 2);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ── Deterministic mock engine ──────────────────────────────────────────
// Used when AI_PROVIDER=mock. Behaves like a real model for pipeline
// testing: preserves sentinels (__PH_N__), tags output, deterministic.

const MOCK_GLOSS = {
  ja: [
    [/^create (a )?new (.+)/i, '新しい$2を作成'],
    [/^save$/i, '保存'], [/^cancel$/i, 'キャンセル'], [/^delete$/i, '削除'],
    [/^settings$/i, '設定'], [/^dashboard$/i, 'ダッシュボード'],
    [/^sign in$/i, 'ログイン'], [/^sign up$/i, '新規登録'],
    [/^workspace$/i, 'ワークスペース'], [/^welcome/i, 'ようこそ'],
  ],
  de: [
    [/^create (a )?new (.+)/i, 'Neue $2 erstellen'],
    [/^save$/i, 'Speichern'], [/^cancel$/i, 'Abbrechen'], [/^delete$/i, 'Löschen'],
    [/^settings$/i, 'Einstellungen'], [/^dashboard$/i, 'Übersicht'],
    [/^sign in$/i, 'Anmelden'], [/^sign up$/i, 'Registrieren'],
    [/^workspace$/i, 'Arbeitsbereich'], [/^welcome/i, 'Willkommen'],
  ],
  fr: [
    [/^create (a )?new (.+)/i, 'Créer un nouveau $2'],
    [/^save$/i, 'Enregistrer'], [/^cancel$/i, 'Annuler'], [/^delete$/i, 'Supprimer'],
    [/^settings$/i, 'Paramètres'], [/^dashboard$/i, 'Tableau de bord'],
    [/^sign in$/i, 'Se connecter'], [/^sign up$/i, "S'inscrire"],
    [/^workspace$/i, 'Espace de travail'], [/^welcome/i, 'Bienvenue'],
  ],
};

const MOCK_TAG = { ja: '［JA］', de: '［DE］', fr: '［FR］', zh: '［ZH］', en: '［EN］' };

function mockTranslateOne(text, targetLang) {
  const norm = (targetLang || 'en').toLowerCase().split('-')[0];
  const gloss = MOCK_GLOSS[norm] || [];
  for (const [re, replacement] of gloss) {
    if (re.test(text)) return text.replace(re, replacement);
  }
  // Fall back: tag the string so tests can verify structure preservation.
  return `${MOCK_TAG[norm] || '[T]'}${text}`;
}

async function mockChat(messages, { json } = {}) {
  const prompt = messages.map((m) => m.content).join('\n');
  let content = '';

  // Route mock behavior by prompt markers embedded by prompts.js.
  const taskMatch = prompt.match(/<<<TASK:(\w+)>>>/);
  const task = taskMatch ? taskMatch[1] : 'unknown';

  if (task === 'translate') {
    const langMatch = prompt.match(/<<<TARGET:([\w-]+)>>>/);
    const target = langMatch ? langMatch[1] : 'en';
    const payloadMatch = prompt.match(/<<<PAYLOAD>>>([\s\S]*?)<<<END>>>/);
    const items = JSON.parse(payloadMatch ? payloadMatch[1] : '[]');
    const out = {};
    for (const it of items) out[it.id] = mockTranslateOne(it.text, target);
    content = JSON.stringify(out);
  } else if (task === 'review') {
    // Deterministic "semantic review": flags nothing critical but keeps
    // the pipeline honest — reports empty issue list.
    content = JSON.stringify({ issues: [] });
  } else {
    content = json ? '{}' : 'mock-response';
  }

  const usage = {
    promptTokens: estimateTokens(prompt),
    completionTokens: estimateTokens(content),
  };
  usage.totalTokens = usage.promptTokens + usage.completionTokens;
  return { content, usage, model: 'mock-deterministic', mock: true };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Rough cost table per 1K tokens (USD) — for internal cost stats only.
const COST_PER_1K = {
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
  'gpt-4o': { in: 0.0025, out: 0.01 },
  'mock-deterministic': { in: 0, out: 0 },
};

function estimateCost(usage, model) {
  const c = COST_PER_1K[model] || COST_PER_1K['gpt-4o-mini'];
  return (usage.promptTokens / 1000) * c.in + (usage.completionTokens / 1000) * c.out;
}

module.exports = { chat, estimateTokens, estimateCost, mockTranslateOne };
