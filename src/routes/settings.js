'use strict';
// Admin settings API — runtime configuration for the AI translation model,
// scoring rules and quotas. Token-protected; the API key is write-only.

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const settings = require('../lib/settings');
const { chat } = require('../lib/ai/provider');
const { DIMENSIONS, computeScore } = require('../lib/checker/scorer');

function checkAdmin(req) {
  const got = String(req.headers['x-admin-token'] || req.query.token || '');
  const want = String(config.adminToken || '');
  if (!got || !want) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = function settingsRoutes(db) {
  const r = express.Router();

  r.use('/api/admin/settings', (req, res, next) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized. A valid x-admin-token is required.' });
    next();
  });

  // GET — never returns the raw API key, only a masked hint.
  r.get('/api/admin/settings', (req, res) => {
    res.json(settings.publicSettings(db));
  });

  // GET meta — form schema + documented defaults for the UI.
  r.get('/api/admin/settings/meta', (req, res) => {
    res.json({
      dimensionKeys: Object.keys(DIMENSIONS),
      issueTypes: Object.keys(settings.DEFAULTS.scoring.issueDimension),
      defaults: {
        ai: { ...settings.DEFAULTS.ai, apiKey: undefined },
        scoring: settings.DEFAULTS.scoring,
        quota: settings.DEFAULTS.quota,
      },
    });
  });

  // PUT — partial patch { ai?, scoring?, quota? }.
  r.put('/api/admin/settings', (req, res) => {
    try {
      const out = settings.saveSettings(db, req.body || {});
      res.json({ ok: true, settings: out });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Restore environment defaults.
  r.post('/api/admin/settings/reset', (req, res) => {
    res.json({ ok: true, settings: settings.resetSettings(db) });
  });

  // Scoring preview — apply a draft rule set to a fixed sample, no persistence.
  r.post('/api/admin/settings/preview', (req, res) => {
    try {
      const cfg = settings.previewScoringConfig(req.body?.scoring || {}, db);
      const sampleIssues = [
        { issueType: 'missing_translation', severity: 'high' },
        { issueType: 'placeholder', severity: 'high' },
        { issueType: 'ui_length', severity: 'medium' },
        { issueType: 'terminology', severity: 'low' },
      ];
      const evaluated = Object.fromEntries(Object.keys(DIMENSIONS).map((k) => [k, true]));
      const result = computeScore(sampleIssues, evaluated, 100, cfg);
      res.json({ ok: true, sample: '4 issues / 100 samples', overall: result.overall, dimensions: result.dimensions });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Connectivity test — real single call with the CURRENT config.
  r.post('/api/admin/settings/test-ai', async (req, res) => {
    const started = Date.now();
    const cfg = settings.getAiConfig(db);
    try {
      const out = await chat([{ role: 'user', content: 'Reply with the single word: OK' }], { timeoutMs: Math.min(cfg.timeoutMs, 15000), maxRetries: 0 });
      res.json({ ok: true, provider: cfg.provider, model: out.model || cfg.model, mock: !!out.mock, latencyMs: Date.now() - started });
    } catch (err) {
      res.json({ ok: false, provider: cfg.provider, model: cfg.model, latencyMs: Date.now() - started, error: err.message });
    }
  });

  return r;
};
