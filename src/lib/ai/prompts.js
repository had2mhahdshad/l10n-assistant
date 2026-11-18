'use strict';
// Prompt builders. Kept in one module so the exact prompts are reviewable
// and versioned (see docs/PROMPTS.md).

const LANG_LABEL = {
  en: 'English', 'zh-CN': 'Simplified Chinese', zh: 'Simplified Chinese',
  ja: 'Japanese', de: 'German', fr: 'French',
};

function langLabel(code) {
  return LANG_LABEL[code] || LANG_LABEL[(code || '').split('-')[0]] || code;
}

/**
 * Batch translation prompt. Items are pre-masked (__PH_N__ sentinels)
 * so variables, HTML and URLs reach the model in a protected form.
 */
function buildTranslatePrompt({
  sourceLang, targetLang, items, productType, context,
  glossary = [], brandTerms = [], doNotTranslate = [], style = 'product-neutral', extra = '',
}) {
  const glossaryBlock = glossary.length
    ? glossary.map((g) => `  - "${g.sourceTerm}" → "${g.targetTerm}"${g.description ? ` (${g.description})` : ''}`).join('\n')
    : '  (none)';
  const brandBlock = [...brandTerms, ...doNotTranslate].length
    ? [...brandTerms, ...doNotTranslate].map((b) => `  - ${b}`).join('\n')
    : '  (none)';

  const system = [
    `You are a senior localization engineer translating ${langLabel(sourceLang)} SaaS product copy into ${langLabel(targetLang)}.`,
    'Rules:',
    '1. Translate meaning, not words — never produce mechanical literal translations.',
    '2. Use native, idiomatic phrasing appropriate for professional SaaS UI copy.',
    '3. Keep translations as concise as the source allows.',
    '4. NEVER add features, claims or promises that do not exist in the source.',
    '5. Tokens like __PH_0__, __PH_1__ are protected placeholders. Keep them EXACTLY as-is, in the correct position for the target language grammar.',
    '6. Respect the glossary and never translate listed brand terms.',
    '7. Return ONLY a JSON object mapping each item id to its translation. No commentary.',
  ].join('\n');

  const user = [
    `<<<TASK:translate>>>`,
    `<<<TARGET:${targetLang}>>>`,
    `Source language: ${langLabel(sourceLang)}`,
    `Target language: ${langLabel(targetLang)}`,
    `Product type: ${productType || 'SaaS web application'}`,
    `Product context: ${context || '(not provided)'}`,
    `Tone / style: ${style}`,
    extra ? `Additional requirements: ${extra}` : null,
    `Glossary (must use):`,
    glossaryBlock,
    `Brand / do-not-translate terms:`,
    brandBlock,
    `Translate each item. <<<PAYLOAD>>>`,
    JSON.stringify(items),
    `<<<END>>>`,
    'Respond with a single JSON object: { "<id>": "<translation>", ... }',
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Semantic review prompt for the Localization Checker — evaluates accuracy
 * and naturalness of existing translations found on a live site.
 */
function buildReviewPrompt({ sourceLang, targetLang, pairs }) {
  const system = [
    `You are a professional ${langLabel(targetLang)} localization reviewer for SaaS products.`,
    'For each pair, judge the EXISTING translation on:',
    '- semantic accuracy (does it convey the source meaning, no omissions or functional drift)',
    '- naturalness (native phrasing, grammar, SaaS context fit, no stiff literal translation)',
    'Return ONLY JSON: { "issues": [ { "id": "<pair id>", "issueType": "semantic_error|grammar|unnatural|terminology", "severity": "high|medium|low", "reason": "<short explanation>", "suggestionDirection": "<direction only, NOT a full corrected translation>" } ] }',
    'Only report genuine problems. If a pair is fine, omit it.',
    'IMPORTANT: provide suggestionDirection as guidance only — do not deliver full corrected translations.',
  ].join('\n');

  const user = [
    `<<<TASK:review>>>`,
    `Source language: ${langLabel(sourceLang)}. Target language: ${langLabel(targetLang)}.`,
    `<<<PAYLOAD>>>`,
    JSON.stringify(pairs),
    `<<<END>>>`,
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

module.exports = { buildTranslatePrompt, buildReviewPrompt, langLabel };
