'use strict';
// Font Recommendation & Integration public API (stage one).
//
// Stage-one scope: recommendation, CSS config generation and upstream jump
// links. NO online preview, NO dynamic subsetting, NO font CDN, NO automatic
// edits to a customer's website, NO bundled font binaries unless licensed.

const express = require('express');
const { getFontsConfig, getCommerceConfig } = require('../lib/settings');
const fonts = require('../lib/fonts');
const { streamZip } = require('../lib/export');

module.exports = function fontRoutes(db) {
  const r = express.Router();

  function cfg() {
    return { fonts: getFontsConfig(db), commerce: getCommerceConfig(db) };
  }

  /** GET /api/fonts/recommend?lang=ja&tier=free */
  r.get('/api/fonts/recommend', (req, res) => {
    const c = cfg();
    if (!c.fonts.enabled) return res.status(404).json({ error: 'Font recommendation is disabled.' });
    const lang = String(req.query.lang || 'en');
    const result = fonts.recommend(lang, c, String(req.query.tier || 'free'));
    res.json({ ok: true, ...result });
  });

  /** GET /api/fonts/tiers — public commercialisation tiers (data-driven). */
  r.get('/api/fonts/tiers', (req, res) => {
    const c = cfg();
    res.json({ ok: true, tiers: c.fonts.tiers, currency: c.commerce.currency, paymentEnabled: !!c.commerce.paymentEnabled, note: c.commerce.quoteNote });
  });

  /** POST /api/fonts/config — generate a CSS config without persisting. */
  r.post('/api/fonts/config', (req, res) => {
    const c = cfg();
    const lang = String(req.body?.lang || 'en');
    const fontId = String(req.body?.fontId || '');
    const font = fonts.findFont(fontId, c);
    if (!font) return res.status(400).json({ error: 'Unknown fontId.' });
    if (!fonts.covers(font, fonts.requiredScripts(lang))) {
      return res.status(400).json({
        error: `This font does not cover every script required by ${lang}.`,
        requiredScripts: fonts.requiredScripts(lang),
        fontScripts: font.scripts,
      });
    }
    if (!fonts.licenseAllows(font, 'config')) {
      return res.status(403).json({ error: 'This font license does not permit generating a config for this use.' });
    }
    const out = fonts.buildConfigCss(lang, font, c);
    res.json({ ok: true, ...out, font: fonts.publicFont(font) });
  });

  /** GET /api/fonts/css?lang=ja&fontId=... — download one CSS file. */
  r.get('/api/fonts/css', (req, res) => {
    const c = cfg();
    const lang = String(req.query.lang || 'en');
    const font = fonts.findFont(req.query.fontId, c);
    if (!font || !fonts.covers(font, fonts.requiredScripts(lang))) {
      return res.status(400).json({ error: 'Unknown fontId or insufficient script coverage.' });
    }
    const out = fonts.buildConfigCss(lang, font, c);
    res.setHeader('content-type', 'text/css; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${out.filename}"`);
    return res.send(out.css);
  });

  /**
   * GET /api/fonts/package?lang=ja&fontId=...
   * A standalone font configuration ZIP (styles/ + fonts/README.md + README).
   * It intentionally contains NO locale JSON — translation files are a
   * separate download. Use /api/translate/jobs/:id/export?format=package for
   * the combined localization-package.
   */
  r.get('/api/fonts/package', (req, res) => {
    const c = cfg();
    const lang = String(req.query.lang || 'en');
    const font = fonts.findFont(req.query.fontId, c);
    if (!font || !fonts.covers(font, fonts.requiredScripts(lang))) {
      return res.status(400).json({ error: 'Unknown fontId or insufficient script coverage.' });
    }
    const built = fonts.buildConfigCss(lang, font, c);
    const files = fonts.buildLocalizationPackage({
      locales: [],
      fontConfigs: [{ font: fonts.publicFont(font), config: built }],
      manifest: null,
      cfg: c,
    }, 'font-config-package');
    return streamZip(res, files, 'font-config-package.zip');
  });

  return r;
};
