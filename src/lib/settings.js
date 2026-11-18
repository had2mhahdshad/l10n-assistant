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
  },
};

const KEYS = ['ai', 'scoring', 'quota'];
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

/** Persist a partial patch. Returns the updated public payload. */
function saveSettings(db, patch = {}) {
  const s = JSON.parse(JSON.stringify(load(db)));
  if (patch.ai) s.ai = validateAi(patch.ai, s.ai);
  if (patch.scoring) s.scoring = validateScoring(patch.scoring, s.scoring);
  if (patch.quota) s.quota = validateQuota(patch.quota, s.quota);

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
  publicSettings, saveSettings, resetSettings, clearSettingsCache, previewScoringConfig,
};
