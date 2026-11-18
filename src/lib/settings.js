'use strict';
// Runtime settings store. Environment variables provide the defaults; an
// authenticated admin can override them without restarting the process.
//
// Security contract:
//   - The AI API key is stored server-side only. It is NEVER returned by the
//     public settings payload (only a masked hint + a boolean).
//   - Every read/write of settings goes through an admin-token check in the
//     settings route. This module itself has no network surface.
//   - Values are validated before persistence so a bad config cannot crash
//     the scoring engine or point the AI client at a non-HTTP endpoint.

const config = require('../config');
const { getDb } = require('../db');
const { DIMENSIONS, ISSUE_DIMENSION, SCORE_MODEL } = require('./checker/scorer');
const fontCatalog = require('../data/fontCatalog');

const SEVERITY_WEIGHT = { high: 1, medium: 0.5, low: 0.25 };

const DEFAULTS = {
  ai: {
    provider: config.ai.provider,
    apiKey: config.ai.apiKey,
    baseUrl: config.ai.baseUrl,
    model: config.ai.model,
    temperature: 0.2,
    timeoutMs: config.ai.timeoutMs,
    maxRetries: config.ai.maxRetries,
  },
  scoring: {
    dimensions: Object.fromEntries(
      Object.entries(DIMENSIONS).map(([k, v]) => [k, { weight: v.weight, label: v.label }])
    ),
    severityWeight: { ...SEVERITY_WEIGHT },
    model: { ...SCORE_MODEL },
    issueDimension: { ...ISSUE_DIMENSION },
  },
  quota: {
    anonAuditDaily: config.quota.anonAuditDaily,
    userAuditMonthly: config.quota.userAuditMonthly,
    freeReportFullExamples: config.quota.freeReportFullExamples,
    freeTranslateStrings: config.quota.freeTranslateStrings,
    freeUrlPagesPerJob: config.quota.freeUrlPagesPerJob,
    freeJsonStringsPerJob: config.quota.freeJsonStringsPerJob,
    freeJsonCharsPerJob: config.quota.freeJsonCharsPerJob,
  },
  // ── Translation product rules (admin-configurable, never hardcoded) ─────
  translation: {
    enabledTargetLocales: ['en', 'ja', 'de', 'fr', 'zh'],
    freeLocales: ['en', 'ja', 'de', 'fr', 'zh'],
    sourceLocales: ['en', 'zh', 'zh-CN', 'ja', 'de', 'fr'],
    // Hard MVP ceiling on pages fetched from a URL, independent of quota.
    mvpUrlPageLimit: 3,
    urlNotFullSite: true,
    allowDownloadOfFreePortion: true,
  },
  // ── Font recommendation data (drives all recommendations / licenses) ───
  fonts: {
    enabled: true,
    defaultFontDisplay: 'swap',
    cdnCacheSeconds: 31536000,
    tiers: {
      free: { label: 'Free', price: null, currency: 'CNY', note: 'System-font recommendations and CSS fallback configuration.' },
      typographyPack: { label: 'Typography Pack', price: null, currency: 'CNY', note: 'Premium font recommendations, config files and licensed font resources. Quoted separately.' },
      professionalLocalization: { label: 'Professional Localization', price: null, currency: 'CNY', note: 'Translation + human review + typography adaptation, quoted per project.' },
    },
    catalog: fontCatalog.CATALOG,
  },
  // ── Commercialisation (pricing / tiers are data, not code) ──────────────
  commerce: {
    currency: 'CNY',
    contactUrl: '/professional',
    paymentEnabled: false,
    // Empty = use the localised default from i18n; an admin may override.
    quoteNote: '',
    unlockLabel: '',
  },
};

const KEYS = ['ai', 'scoring', 'quota', 'translation', 'fonts', 'commerce'];
// Cache is per-database-instance so tests using a temp DB never leak config
// into the production connection (and vice versa).
let cacheMap = new WeakMap();

function readRow(db, key) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function load(db) {
  if (cacheMap.has(db)) return cacheMap.get(db);
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const key of KEYS) {
    const stored = readRow(db, key);
    if (stored && typeof stored === 'object') {
      if (key === 'scoring') {
        // Deep merge so a stored subset never wipes unseen dimensions.
        for (const sub of ['dimensions', 'severityWeight', 'model', 'issueDimension']) {
          if (stored[sub]) Object.assign(out.scoring[sub], stored[sub]);
        }
      } else {
        Object.assign(out[key], stored);
      }
    }
  }
  cacheMap.set(db, out);
  return out;
}

function getSettings(db = getDb()) { return load(db); }
function getAiConfig(db = getDb()) { return { ...load(db).ai }; }
function getScoringConfig(db = getDb()) { return JSON.parse(JSON.stringify(load(db).scoring)); }
function getQuotaConfig(db = getDb()) { return { ...load(db).quota }; }
function getTranslationConfig(db = getDb()) { return JSON.parse(JSON.stringify(load(db).translation)); }
function getFontsConfig(db = getDb()) { return JSON.parse(JSON.stringify(load(db).fonts)); }
function getCommerceConfig(db = getDb()) { return JSON.parse(JSON.stringify(load(db).commerce)); }
function clearSettingsCache() { cacheMap = new WeakMap(); }

/** Payload safe to send to the browser: never includes the raw API key. */
function publicSettings(db = getDb()) {
  const s = load(db);
  const ai = { ...s.ai };
  const key = String(ai.apiKey || '');
  return {
    ai: {
      provider: ai.provider,
      baseUrl: ai.baseUrl,
      model: ai.model,
      temperature: ai.temperature,
      timeoutMs: ai.timeoutMs,
      maxRetries: ai.maxRetries,
      apiKeySet: key.length > 0,
      apiKeyHint: key ? '••••' + key.slice(-4) : '',
    },
    scoring: JSON.parse(JSON.stringify(s.scoring)),
    quota: { ...s.quota },
    translation: JSON.parse(JSON.stringify(s.translation)),
    fonts: JSON.parse(JSON.stringify(s.fonts)),
    commerce: JSON.parse(JSON.stringify(s.commerce)),
  };
}

function num(v, dflt, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function validateAi(patch, current) {
  const out = { ...current };
  if (patch.provider !== undefined) {
    if (!['mock', 'openai'].includes(String(patch.provider))) throw new Error('provider must be mock or openai');
    out.provider = patch.provider;
  }
  if (patch.baseUrl !== undefined) {
    let u;
    try { u = new URL(String(patch.baseUrl)); } catch { throw new Error('baseUrl must be an absolute URL'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('baseUrl must use http(s)');
    out.baseUrl = String(patch.baseUrl).replace(/\/+$/, '');
  }
  if (patch.model !== undefined) out.model = String(patch.model).trim().slice(0, 120) || current.model;
  // Key is write-only: empty or sentinel keeps the existing value.
  if (patch.apiKey !== undefined && patch.apiKey !== '' && patch.apiKey !== '__KEEP__') {
    out.apiKey = patch.apiKey === '__CLEAR__' ? '' : String(patch.apiKey);
  }
  if (patch.temperature !== undefined) out.temperature = num(patch.temperature, out.temperature, 0, 2);
  if (patch.timeoutMs !== undefined) out.timeoutMs = Math.round(num(patch.timeoutMs, out.timeoutMs, 1000, 300000));
  if (patch.maxRetries !== undefined) out.maxRetries = Math.round(num(patch.maxRetries, out.maxRetries, 0, 5));
  return out;
}

function validateScoring(patch, current) {
  const out = JSON.parse(JSON.stringify(current));
  if (patch.dimensions && typeof patch.dimensions === 'object') {
    for (const [k, v] of Object.entries(patch.dimensions)) {
      if (!out.dimensions[k]) continue;
      out.dimensions[k] = {
        weight: num(v.weight, out.dimensions[k].weight, 0, 100),
        label: String(v.label || out.dimensions[k].label).slice(0, 80),
      };
    }
    const sum = Object.values(out.dimensions).reduce((a, d) => a + d.weight, 0);
    if (sum <= 0) throw new Error('At least one dimension weight must be greater than 0');
    // Normalize to sum = 1 so the UI can accept any convenient scale (%, points).
    for (const d of Object.values(out.dimensions)) d.weight = Math.round((d.weight / sum) * 10000) / 10000;
  }
  if (patch.severityWeight && typeof patch.severityWeight === 'object') {
    for (const k of Object.keys(out.severityWeight)) {
      if (patch.severityWeight[k] !== undefined) {
        out.severityWeight[k] = num(patch.severityWeight[k], out.severityWeight[k], 0, 10);
      }
    }
  }
  if (patch.model && typeof patch.model === 'object') {
    for (const k of Object.keys(out.model)) {
      if (patch.model[k] !== undefined) out.model[k] = num(patch.model[k], out.model[k], 0, 100000);
    }
  }
  if (patch.issueDimension && typeof patch.issueDimension === 'object') {
    for (const [type, dim] of Object.entries(patch.issueDimension)) {
      if (out.dimensions[dim]) out.issueDimension[type] = dim;
    }
  }
  return out;
}

function validateQuota(patch, current) {
  const out = { ...current };
  for (const k of Object.keys(out)) {
    if (patch[k] !== undefined) out[k] = Math.round(num(patch[k], out[k], 0, 1000000));
  }
  return out;
}

// ── validators for the new runtime config groups ──────────────────────────

function strList(v, current, max = 32) {
  if (!Array.isArray(v)) return current;
  const out = [...new Set(v.filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim().slice(0, 40)))];
  return out.length ? out.slice(0, max) : current;
}

function safeHttpUrl(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  try { const u = new URL(t); return ['http:', 'https:'].includes(u.protocol) ? t : ''; }
  catch { return ''; }
}

function validateTranslation(patch, current) {
  const out = { ...current };
  for (const k of ['enabledTargetLocales', 'freeLocales', 'sourceLocales']) {
    if (patch[k] !== undefined) out[k] = strList(patch[k], current[k]);
  }
  if (patch.mvpUrlPageLimit !== undefined) {
    out.mvpUrlPageLimit = Math.round(num(patch.mvpUrlPageLimit, out.mvpUrlPageLimit, 1, 100));
  }
  for (const k of ['urlNotFullSite', 'allowDownloadOfFreePortion']) {
    if (patch[k] !== undefined) out[k] = !!patch[k];
  }
  return out;
}

/** Clean one font record. Hard rule: a font may only be bundled when its
 *  license explicitly allows redistribution. */
function cleanFont(f) {
  if (!f || typeof f !== 'object') return null;
  const id = String(f.id || '').trim().slice(0, 80);
  const name = String(f.name || '').trim().slice(0, 120);
  const family = String(f.family || '').trim().slice(0, 400);
  if (!id || !name || !family) return null;
  const lic = (f.license && typeof f.license === 'object') ? f.license : {};
  const license = {
    name: String(lic.name || 'Unknown').trim().slice(0, 200),
    url: safeHttpUrl(lic.url),
    allowRedistribution: !!lic.allowRedistribution,
    scope: String(lic.scope || '').trim().slice(0, 400),
  };
  const provider = ['system', 'online', 'self-host'].includes(f.provider) ? f.provider : 'system';
  return {
    id, name, family,
    style: String(f.style || '').trim().slice(0, 200),
    scripts: strList(f.scripts, ['latin'], 16),
    provider,
    useCase: String(f.useCase || '').trim().slice(0, 300),
    license,
    sourceUrl: safeHttpUrl(f.sourceUrl),
    downloadUrl: safeHttpUrl(f.downloadUrl),
    cssUrl: safeHttpUrl(f.cssUrl),
    // Even an admin cannot mark an unlicensed font as packagable.
    packagable: !!f.packagable && license.allowRedistribution === true,
    tier: ['free', 'typography-pack'].includes(f.tier) ? f.tier : 'free',
    woff2: !!f.woff2,
    weightRange: String(f.weightRange || '').trim().slice(0, 80),
    unicodeRange: f.unicodeRange ? String(f.unicodeRange).slice(0, 1200) : null,
    notes: String(f.notes || '').trim().slice(0, 600),
  };
}

function cleanTier(t, current) {
  if (!t || typeof t !== 'object') return current;
  const price = (t.price === null || t.price === '' || t.price === undefined)
    ? null
    : (Number.isFinite(Number(t.price)) ? Number(t.price) : current.price);
  return {
    label: String(t.label || current.label).slice(0, 80),
    price,
    currency: String(t.currency || current.currency).slice(0, 8),
    note: String(t.note || current.note).slice(0, 400),
  };
}

function validateFonts(patch, current) {
  const out = JSON.parse(JSON.stringify(current));
  if (patch.enabled !== undefined) out.enabled = !!patch.enabled;
  if (patch.defaultFontDisplay !== undefined) {
    const d = String(patch.defaultFontDisplay);
    if (['swap', 'optional', 'fallback', 'block', 'auto'].includes(d)) out.defaultFontDisplay = d;
  }
  if (patch.cdnCacheSeconds !== undefined) {
    out.cdnCacheSeconds = Math.round(num(patch.cdnCacheSeconds, out.cdnCacheSeconds, 0, 315360000));
  }
  if (patch.tiers && typeof patch.tiers === 'object') {
    for (const k of Object.keys(out.tiers)) {
      if (patch.tiers[k]) out.tiers[k] = cleanTier(patch.tiers[k], out.tiers[k]);
    }
  }
  if (patch.catalog !== undefined) {
    if (!Array.isArray(patch.catalog)) throw new Error('fonts.catalog must be an array');
    const cleaned = patch.catalog.map(cleanFont).filter(Boolean);
    if (!cleaned.length) throw new Error('fonts.catalog must contain at least one valid font');
    const seen = new Set();
    out.catalog = [];
    for (const f of cleaned) if (!seen.has(f.id)) { seen.add(f.id); out.catalog.push(f); }
  }
  return out;
}

function validateCommerce(patch, current) {
  const out = { ...current };
  if (patch.currency !== undefined) out.currency = String(patch.currency).trim().slice(0, 8) || current.currency;
  if (patch.contactUrl !== undefined) out.contactUrl = String(patch.contactUrl).trim().slice(0, 200) || current.contactUrl;
  if (patch.paymentEnabled !== undefined) out.paymentEnabled = !!patch.paymentEnabled;
  if (patch.quoteNote !== undefined) out.quoteNote = String(patch.quoteNote).trim().slice(0, 400) || current.quoteNote;
  if (patch.unlockLabel !== undefined) out.unlockLabel = String(patch.unlockLabel).trim().slice(0, 120) || current.unlockLabel;
  return out;
}

/** Persist a partial patch. Returns the updated public payload. */
function saveSettings(db, patch = {}) {
  const s = JSON.parse(JSON.stringify(load(db)));
  if (patch.ai) s.ai = validateAi(patch.ai, s.ai);
  if (patch.scoring) s.scoring = validateScoring(patch.scoring, s.scoring);
  if (patch.quota) s.quota = validateQuota(patch.quota, s.quota);
  if (patch.translation) s.translation = validateTranslation(patch.translation, s.translation);
  if (patch.fonts) s.fonts = validateFonts(patch.fonts, s.fonts);
  if (patch.commerce) s.commerce = validateCommerce(patch.commerce, s.commerce);

  const now = new Date().toISOString();
  const stmt = db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  for (const key of KEYS) {
    if (patch[key]) stmt.run(key, JSON.stringify(s[key]), now);
  }
  cacheMap.set(db, s);
  return publicSettings(db);
}

function resetSettings(db) {
  for (const key of KEYS) db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  clearSettingsCache();
  return publicSettings(db);
}

/** Validate a scoring patch WITHOUT persisting it (for the UI preview). */
function previewScoringConfig(patch = {}, db = getDb()) {
  return validateScoring(patch, getScoringConfig(db));
}

module.exports = {
  DEFAULTS, getSettings, getAiConfig, getScoringConfig, getQuotaConfig,
  getTranslationConfig, getFontsConfig, getCommerceConfig,
  publicSettings, saveSettings, resetSettings, clearSettingsCache, previewScoringConfig,
};
