'use strict';
// Recursive JSON parsing with structure protection.
//
// parseTranslatable(json) flattens a locale JSON into entries:
//   { key: 'nav.cta', path: [...], value, type, translatable, reason }
// rebuildJson(entries, original) reconstructs the file, guaranteeing:
//   - identical keys, order, nesting, data types
//   - arrays keep order and element types
// Non-string scalars (numbers, booleans, null) are never translated.

const { placeholderTokens } = require('./placeholder');

const NON_TRANSLATABLE_KEY_RE = /(^id$|_id$|^key$|^slug$|^icon$|^color$|^theme$|^locale$|^lang(uage)?$|url$|^uri$|^link$|^src$|^href$|^path$|^route$|^email$|^phone$|^image$|^logo$|^avatar$|^class(Name)?$|^style$|^font|^api|^token$|^secret$|^hash$|^uuid$)/i;

// Strings that are almost certainly not UI copy.
function looksNonTranslatable(value) {
  const v = value.trim();
  if (!v) return { yes: true, reason: 'empty' };
  if (/^https?:\/\//i.test(v)) return { yes: true, reason: 'url' };
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v)) return { yes: true, reason: 'email' };
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return { yes: true, reason: 'color-hex' };
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(v) && v.length > 40) return { yes: true, reason: 'jwt-like' };
  if (/^[\w./-]+\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|mp4|webm|pdf|zip)$/i.test(v)) return { yes: true, reason: 'asset-path' };
  if (/^\d+(\.\d+)?$/.test(v)) return { yes: true, reason: 'numeric-string' };
  if (/^[A-Z0-9_]{2,}$/.test(v) && v.length <= 32 && !v.includes('_ ')) {
    // CONSTANT_CASE keys — often enums. Only skip when there is no lowercase at all.
    return { yes: true, reason: 'constant-case' };
  }
  return { yes: false };
}

/**
 * Flatten JSON into entries. ignoreRules: array of RegExp matched against
 * dotted key; matching keys are marked translatable=false (user override).
 */
function parseTranslatable(json, { ignoreRules = [] } = {}) {
  const entries = [];

  function walk(node, path) {
    if (node === null || typeof node === 'number' || typeof node === 'boolean') {
      entries.push({
        key: path.join('.'),
        path: [...path],
        value: node,
        type: node === null ? 'null' : typeof node,
        translatable: false,
        reason: 'scalar',
      });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, i]));
      return;
    }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], [...path, k]);
      return;
    }
    if (typeof node === 'string') {
      const key = path.join('.');
      const ignored = ignoreRules.some((re) => re.test(key));
      const auto = looksNonTranslatable(node);
      const keyHint = NON_TRANSLATABLE_KEY_RE.test(String(path[path.length - 1] ?? ''));
      const translatable = !ignored && !auto.yes && !keyHint;
      entries.push({
        key,
        path: [...path],
        value: node,
        type: 'string',
        translatable,
        reason: ignored ? 'user-ignore-rule' : auto.yes ? auto.reason : keyHint ? 'key-hint' : null,
        placeholders: translatable ? placeholderTokens(node) : [],
        chars: node.length,
      });
    }
  }

  walk(json, []);
  return entries;
}

/**
 * Rebuild the JSON file from (possibly translated) entries while preserving
 * the original structure. `translations` maps dotted key -> translated string.
 * Only entries that were strings in the original are touched; all other
 * values, key order and nesting come from `original`.
 */
function rebuildJson(original, translations = {}) {
  function clone(node, path) {
    if (Array.isArray(node)) return node.map((item, i) => clone(item, [...path, i]));
    if (node !== null && typeof node === 'object') {
      const out = {};
      for (const k of Object.keys(node)) out[k] = clone(node[k], [...path, k]);
      return out;
    }
    if (typeof node === 'string') {
      const key = path.join('.');
      const t = translations[key];
      return typeof t === 'string' ? t : node;
    }
    return node;
  }
  return clone(original, []);
}

/**
 * Structural integrity check between source JSON and a translated JSON.
 * Returns list of problems (empty = ok).
 */
function verifyStructure(source, translated) {
  const problems = [];

  function shape(node, path, out) {
    if (Array.isArray(node)) {
      out.push({ path, type: 'array', length: node.length });
      node.forEach((it, i) => shape(it, `${path}[${i}]`, out));
      return;
    }
    if (node !== null && typeof node === 'object') {
      out.push({ path, type: 'object', keys: Object.keys(node) });
      for (const k of Object.keys(node)) shape(node[k], path ? `${path}.${k}` : k, out);
      return;
    }
    out.push({ path, type: node === null ? 'null' : typeof node });
  }

  const a = [], b = [];
  shape(source, '', a);
  shape(translated, '', b);

  const mapB = new Map(b.map((x) => [x.path, x]));
  for (const sa of a) {
    const sb = mapB.get(sa.path);
    if (!sb) {
      problems.push({ type: 'missing-node', path: sa.path });
      continue;
    }
    if (sa.type !== sb.type) problems.push({ type: 'type-mismatch', path: sa.path, expected: sa.type, got: sb.type });
    if (sa.type === 'object') {
      const ka = sa.keys.join('|'), kb = sb.keys.join('|');
      if (ka !== kb) problems.push({ type: 'key-order-mismatch', path: sa.path, expected: sa.keys, got: sb.keys });
    }
    if (sa.type === 'array' && sa.length !== sb.length) {
      problems.push({ type: 'array-length-mismatch', path: sa.path, expected: sa.length, got: sb.length });
    }
  }
  for (const sb of b) {
    if (!a.find((x) => x.path === sb.path)) problems.push({ type: 'extra-node', path: sb.path });
  }
  return problems;
}

/** Count keys / translatable strings helper. */
function stats(entries) {
  const strings = entries.filter((e) => e.type === 'string');
  return {
    totalKeys: entries.length,
    totalStrings: strings.length,
    translatable: strings.filter((e) => e.translatable).length,
    skipped: strings.filter((e) => !e.translatable).length,
    chars: strings.filter((e) => e.translatable).reduce((s, e) => s + e.chars, 0),
  };
}

module.exports = { parseTranslatable, rebuildJson, verifyStructure, stats, looksNonTranslatable };
