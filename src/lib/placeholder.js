'use strict';
// Extensible placeholder recognition & protection.
//
// Supported syntaxes out of the box:
//   {name}  {{name}}  ${name}  {count}  %s %d %f %.2f  :name
//   HTML tags  <b>, </span>, <br/>
//   URLs  https://example.com/x
//   Markdown links/images  [text](url) ![alt](url)
//   ICU-ish plurals {count, plural, ...} are captured by the {…} family.
//
// Additional patterns can be registered at runtime via registerPattern().

const PATTERNS = [
  { name: 'double-brace', re: /\{\{\s*[A-Za-z_][\w.\-]*\s*\}\}/g },
  { name: 'dollar-brace', re: /\$\{\s*[A-Za-z_][\w.\-]*\s*\}/g },
  { name: 'single-brace', re: /\{\s*[A-Za-z_][\w.\-]*(\s*,\s*[^{}]+)*\s*\}/g },
  { name: 'printf', re: /%(?:\d+\$)?[+\-0-9.]*[sdifuoxXeEgGc%]/g },
  { name: 'colon-param', re: /(^|[\s(])(:[A-Za-z_][\w\-]*)/g, group: 2 },
  { name: 'html-tag', re: /<\/?[A-Za-z][^<>]*?>/g },
  { name: 'md-image', re: /!\[[^\]]*\]\([^)\s]+\)/g },
  { name: 'md-link', re: /\[[^\]]+\]\([^)\s]+\)/g },
  { name: 'url', re: /https?:\/\/[^\s<>"')\]]+/g },
  { name: 'html-entity', re: /&(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);/g },
];

// Order matters: longer / more specific patterns first so extraction is stable.
const ORDER = ['md-image', 'md-link', 'double-brace', 'dollar-brace', 'single-brace', 'url', 'html-tag', 'html-entity', 'printf', 'colon-param'];

const extraPatterns = [];

function registerPattern(name, re) {
  if (!(re instanceof RegExp)) throw new Error('pattern must be a RegExp');
  extraPatterns.push({ name, re: new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g') });
}

function allPatterns() {
  const map = new Map(PATTERNS.map((p) => [p.name, p]));
  const ordered = ORDER.map((n) => map.get(n)).filter(Boolean);
  return ordered.concat(extraPatterns);
}

/**
 * Extract placeholders from a string.
 * Returns sorted array of unique placeholder tokens with their pattern name.
 */
function extractPlaceholders(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = new Map(); // token -> pattern name
  for (const p of allPatterns()) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const token = p.group ? m[p.group] : m[0];
      if (p.name === 'colon-param') {
        // avoid false positives like "http:" times "12:30"
        const before = text[m.index - 1];
        if (before === ':' || /\d/.test(before || '')) continue;
      }
      if (!found.has(token)) found.set(token, p.name);
      if (m.index === p.re.lastIndex) p.re.lastIndex++; // safety for zero-width
    }
  }
  return [...found.entries()].map(([token, pattern]) => ({ token, pattern }));
}

function placeholderTokens(text) {
  return extractPlaceholders(text).map((p) => p.token);
}

/**
 * Replace placeholders with sentinel tokens (PH_0 …) that survive MT engines,
 * so the AI cannot mangle them. Returns { text, tokens } where tokens maps
 * sentinel -> original token.
 */
function maskPlaceholders(text) {
  const tokens = [];
  let out = String(text);
  // Replace longer tokens first to avoid partial overlaps.
  const phs = extractPlaceholders(text).sort((a, b) => b.token.length - a.token.length);
  phs.forEach((p, i) => {
    const sentinel = `__PH_${i}__`;
    tokens.push({ sentinel, token: p.token, pattern: p.pattern });
    out = out.split(p.token).join(sentinel);
  });
  return { text: out, tokens };
}

/** Restore sentinels back to original placeholders. */
function unmaskPlaceholders(text, tokens) {
  let out = String(text);
  for (const t of tokens) {
    out = out.split(t.sentinel).join(t.token);
  }
  return out;
}

/**
 * Verify every source placeholder survived in the translation.
 * Returns { ok, missing, extra }.
 */
function verifyPlaceholders(sourceText, translatedText) {
  const src = placeholderTokens(sourceText);
  const dst = placeholderTokens(translatedText);
  const count = (arr) => arr.reduce((m, t) => (m.set(t, (m.get(t) || 0) + 1), m), new Map());
  const cs = count(src), cd = count(dst);
  const missing = [], extra = [];
  for (const [t, n] of cs) {
    const have = cd.get(t) || 0;
    if (have < n) missing.push(t);
  }
  for (const [t, n] of cd) {
    const want = cs.get(t) || 0;
    if (want < n && !t.startsWith('__PH_')) extra.push(t);
  }
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/** Extract HTML tag signature (sequence of tag names) for integrity check. */
function htmlSignature(text) {
  const tags = String(text).match(/<\/?[A-Za-z][^<>]*?>/g) || [];
  return tags.map((t) => {
    const m = t.match(/<\/?([A-Za-z][\w-]*)/);
    return (t.startsWith('</') ? '/' : '') + (m ? m[1].toLowerCase() : '?');
  });
}

function verifyHtml(sourceText, translatedText) {
  const a = htmlSignature(sourceText);
  const b = htmlSignature(translatedText);
  const ok = a.length === b.length && a.every((t, i) => t === b[i]);
  return { ok, sourceTags: a, translatedTags: b };
}

/** Extract URLs for change detection. */
function extractUrls(text) {
  return String(text).match(/https?:\/\/[^\s<>"')\]]+/g) || [];
}

function verifyUrls(sourceText, translatedText) {
  const a = extractUrls(sourceText).sort();
  const b = extractUrls(translatedText).sort();
  const changed = a.filter((u) => !b.includes(u));
  const added = b.filter((u) => !a.includes(u));
  return { ok: changed.length === 0 && added.length === 0, changed, added };
}

module.exports = {
  registerPattern,
  extractPlaceholders,
  placeholderTokens,
  maskPlaceholders,
  unmaskPlaceholders,
  verifyPlaceholders,
  verifyHtml,
  verifyUrls,
  htmlSignature,
  extractUrls,
};
