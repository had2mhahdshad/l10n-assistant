'use strict';
// AI Translation API — paid translation workspace module.
// Fully independent from the Localization Checker (own quota, own data).

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { parseTranslatable, rebuildJson, verifyStructure, stats: jsonStats } = require('../lib/jsonParser');
const { translateEntries } = require('../lib/ai/translate');
const quality = require('../lib/quality');
const { buildCsv, buildQaReport, streamZip } = require('../lib/export');
const { pickLang, translator } = require('../lib/i18n');
const { getQuotaConfig, getTranslationConfig, getFontsConfig, getCommerceConfig } = require('../lib/settings');
const { planQuota, snapshot } = require('../lib/translationQuota');
const { urlToJson } = require('../lib/urlToJson');
const fonts = require('../lib/fonts');

module.exports = function translateRoutes(db) {
  const r = express.Router();

  const insertGlossary = (projectId, glossary = []) => {
    const stmt = db.prepare('INSERT INTO glossaries (project_id, source_term, target_term, locale, description) VALUES (?, ?, ?, ?, ?)');
    for (const g of glossary) {
      if (g.sourceTerm && g.targetTerm && g.locale) {
        stmt.run(projectId, g.sourceTerm, g.targetTerm, g.locale, g.description || null);
      }
    }
  };

  // ── Shared job creation (JSON upload OR website URL) ───────────────────
  // Both input modes converge here so quota, structure protection, export and
  // the workspace behave identically. Free quota is enforced PER JOB; the free
  // portion is ALWAYS translatable and downloadable, the rest is reported
  // as locked content instead of blocking the whole job.
  function createJobRecord(req, res, { json, sourceType = 'json', sourceUrl = null, scanMeta = null, body = {} }) {
    const {
      projectName, sourceLanguage, targetLanguages, filename,
      productType, context, style, extra, brandTerms = [], glossary = [], ignoreKeys = [],
    } = body;

    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return res.status(400).json({ error: 'json must be a JSON object (locale file).' });
    }
    const tCfg = getTranslationConfig(db);
    if (!tCfg.sourceLocales.includes(sourceLanguage)) {
      return res.status(400).json({ error: `Source language must be one of: ${tCfg.sourceLocales.join(', ')}` });
    }
    const targets = (Array.isArray(targetLanguages) ? targetLanguages : [])
      .filter((t) => tCfg.enabledTargetLocales.includes(t));
    if (!targets.length) {
      return res.status(400).json({ error: `Target languages must include at least one of: ${tCfg.enabledTargetLocales.join(', ')}` });
    }

    const ignoreRules = (Array.isArray(ignoreKeys) ? ignoreKeys : []).map((p) => {
      try { return new RegExp(p); } catch { return null; }
    }).filter(Boolean);
    const entries = parseTranslatable(json, { ignoreRules });
    const translatable = entries.filter((e) => e.translatable);
    const st = jsonStats(entries);
    if (st.translatable === 0) {
      return res.status(400).json({ error: 'No translatable strings found in this file.' });
    }

    // Optional legacy ACCOUNT-level cap (0 = disabled). Per-job limits are the
    // primary rules; this is only an additional ceiling when explicitly set.
    const qCfg = getQuotaConfig(db);
    let accountRemaining = null;
    if (qCfg.freeTranslateStrings > 0) {
      const where = req.userId ? 'tp.user_id = ?' : 'tj.anon_id = ? AND tp.user_id IS NULL';
      const arg = req.userId || req.anonId;
      const row = db.prepare(
        `SELECT COALESCE(SUM(tj.total_strings), 0) AS used
         FROM translation_jobs tj JOIN translation_projects tp ON tp.id = tj.project_id
         WHERE ${where}`
      ).get(arg);
      accountRemaining = Math.max(0, qCfg.freeTranslateStrings - (row.used || 0));
    }

    const plan = planQuota({
      sourceType,
      locales: targets,
      strings: translatable.map((e) => ({ key: e.key, chars: e.chars || String(e.value).length })),
      pages: scanMeta ? scanMeta.scannedPages : 0,
      discoveredPages: scanMeta ? scanMeta.discoveredPages : 0,
    }, { quota: qCfg, translation: tCfg, accountRemaining });

    const quotaSnap = snapshot(plan);
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const defaultFilename = sourceType === 'url' ? 'url-content.json' : 'common.json';

    db.prepare(`INSERT INTO translation_projects
      (id, user_id, anon_id, project_name, source_language, target_languages, product_type, context, style, extra_requirements, brand_terms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, req.userId, req.anonId, projectName || 'Untitled project', sourceLanguage,
        JSON.stringify(targets), productType || null, context || null, style || 'product-neutral',
        extra || null, JSON.stringify(brandTerms), now);

    db.prepare(`INSERT INTO translation_jobs
      (id, project_id, anon_id, source_file, filename, status, total_strings, created_at, share_token,
       source_type, source_url, scanned_pages, scanned_note, non_translatable,
       locked_strings, locked_keys, quota_snapshot)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?)`)
      .run(jobId, projectId, req.anonId, JSON.stringify(json), filename || defaultFilename,
        st.translatable, now, newShareToken(),
        sourceType, sourceUrl, scanMeta ? scanMeta.scannedPages : 0,
        scanMeta ? JSON.stringify({
          startUrl: scanMeta.startUrl, scannedPages: scanMeta.scannedPages,
          failedPages: scanMeta.failedPages, discoveredPages: scanMeta.discoveredPages,
          maxPages: scanMeta.maxPages, maxDepth: scanMeta.maxDepth,
          segmentCount: scanMeta.segmentCount,
          limitations: scanMeta.limitations, complete: false,
        }) : null,
        scanMeta ? JSON.stringify(scanMeta.nonTranslatable) : null,
        plan.locked.units, JSON.stringify(plan.locked.keys), JSON.stringify(quotaSnap));

    insertGlossary(projectId, glossary);

    // Only the FREE portion becomes a translation entry. Locked strings are
    // never sent to the AI, never billed, and remain original text on export.
    const byKey = new Map(translatable.map((e) => [e.key, e]));
    const ins = db.prepare(`INSERT INTO translation_entries
      (job_id, locale, key, path, source_text, status) VALUES (?, ?, ?, ?, ?, 'pending')`);
    for (const locale of targets) {
      for (const key of (plan.grantedKeysByLocale[locale] || [])) {
        const e = byKey.get(key);
        if (e) ins.run(jobId, locale, key, JSON.stringify(e.path), e.value);
      }
    }

    return res.status(201).json({
      jobId, projectId, sourceType,
      scan: scanMeta ? {
        startUrl: scanMeta.startUrl,
        scannedPages: scanMeta.scannedPages,
        failedPages: scanMeta.failedPages,
        discoveredPages: scanMeta.discoveredPages,
        maxPages: scanMeta.maxPages,
        segmentCount: scanMeta.segmentCount,
        nonTranslatable: scanMeta.nonTranslatable,
        limitations: scanMeta.limitations,
        complete: false,
      } : null,
      stats: {
        ...st,
        billableUnits: plan.requested.units,
        quota: quotaSnap,
      },
    });
  }

  // JSON upload (unchanged endpoint, now quota-aware).
  r.post('/api/translate/jobs', (req, res) => {
    try {
      return createJobRecord(req, res, { json: (req.body || {}).json, body: req.body || {} });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Website URL input: scan within the MVP page limit, produce a standard
  // JSON, then run the SAME job creation / quota / export pipeline.
  r.post('/api/translate/url', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.websiteUrl) return res.status(400).json({ error: 'websiteUrl is required.' });
      const tCfg = getTranslationConfig(db);
      const qCfg = getQuotaConfig(db);
      const maxPages = Math.max(1, Math.min(qCfg.freeUrlPagesPerJob, tCfg.mvpUrlPageLimit));
      const { json, meta } = await urlToJson(body.websiteUrl, { maxPages });
      return createJobRecord(req, res, {
        json, sourceType: 'url', sourceUrl: body.websiteUrl, scanMeta: meta, body,
      });
    } catch (err) {
      console.error('[translate:url]', err);
      return res.status(err.status || 500).json({
        error: err.clientMessage || ('URL scan failed: ' + err.message),
        detail: config.env === 'development' ? err.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
      });
    }
  });

  // Run translation for a job (all locales, or one locale via ?locale=).
  r.post('/api/translate/jobs/:id/run', async (req, res) => {
    const job = getOwnedJob(db, req, res);
    if (!job) return;
    const onlyLocale = req.query.locale || null;
    const force = req.query.force === '1';

    const project = db.prepare('SELECT * FROM translation_projects WHERE id = ?').get(job.project_id);
    // Only entries granted by the per-job Free quota exist in the table.
    // Locked strings are never sent to the AI and never billed.
    const locales = JSON.parse(project.target_languages).filter((l) => !onlyLocale || l === onlyLocale);
    const glossary = db.prepare('SELECT * FROM glossaries WHERE project_id = ?').all(project.id);
    const brandTerms = JSON.parse(project.brand_terms || '[]');

    // Protect manual edits: entries with manually_edited=1 are skipped unless force.
    const manualKeys = new Set(
      db.prepare("SELECT locale || '::' || key AS k FROM translation_entries WHERE job_id = ? AND manually_edited = 1")
        .all(job.id).map((r) => r.k));

    db.prepare("UPDATE translation_jobs SET status='translating' WHERE id=?").run(job.id);

    let totalTokens = 0, totalCost = 0, model = null, failedCount = 0, doneCount = 0;
    try {
      for (const locale of locales) {
        let rows = db.prepare('SELECT key, source_text FROM translation_entries WHERE job_id=? AND locale=? ORDER BY id')
          .all(job.id, locale);
        if (!force) rows = rows.filter((r) => !manualKeys.has(`${locale}::${r.key}`));
        const toTranslate = rows.map((r) => ({ key: r.key, value: r.source_text }));
        if (!toTranslate.length) continue;

        const { translations, failures, stats } = await translateEntries(toTranslate, {
          sourceLang: project.source_language,
          targetLang: locale,
          productType: project.product_type,
          context: project.context,
          style: project.style,
          extra: project.extra_requirements,
          brandTerms,
          glossary: glossary.filter((g) => g.locale === locale).map((g) => ({
            sourceTerm: g.source_term, targetTerm: g.target_term, description: g.description,
          })),
          batchSize: config.quota.translateBatchSize,
        });

        totalTokens += stats.totalTokens;
        totalCost += stats.costUsd;
        model = stats.model;

        const upd = db.prepare(`UPDATE translation_entries
          SET translated_text=?, status='completed', modified_at=? WHERE job_id=? AND locale=? AND key=?`);
        for (const [key, text] of translations) {
          upd.run(text, new Date().toISOString(), job.id, locale, key);
        }
        const failUpd = db.prepare("UPDATE translation_entries SET status='failed', modified_at=? WHERE job_id=? AND locale=? AND key=?");
        for (const f of failures) {
          if (!f.keptTranslation) failUpd.run(new Date().toISOString(), job.id, locale, f.key);
        }
        doneCount += translations.size;
        failedCount += failures.filter((f) => !f.keptTranslation).length;
      }

      db.prepare(`UPDATE translation_jobs SET status='completed', translated_strings=?,
        failed_strings=?, model=?, token_usage=COALESCE(token_usage,0)+?,
        estimated_cost=COALESCE(estimated_cost,0)+?, completed_at=? WHERE id=?`)
        .run(doneCount, failedCount, model, totalTokens, totalCost, new Date().toISOString(), job.id);

      res.json({ status: 'completed', translated: doneCount, failed: failedCount, tokens: totalTokens, costUsd: Number(totalCost.toFixed(6)), model });
    } catch (err) {
      db.prepare("UPDATE translation_jobs SET status='failed' WHERE id=?").run(job.id);
      console.error(err);
      res.status(500).json({ error: 'Translation failed: ' + err.message });
    }
  });

  // Job detail + entries + quality issues (workspace data).
  r.get('/api/translate/jobs/:id', (req, res) => {
    const access = getReadableJob(db, req, res);
    if (!access) return;
    const { job } = access;
    const project = db.prepare('SELECT * FROM translation_projects WHERE id = ?').get(job.project_id);
    let entries = db.prepare('SELECT * FROM translation_entries WHERE job_id = ? ORDER BY key, locale').all(job.id);
    const { status, q, issueType, locale } = req.query;
    if (status) entries = entries.filter((e) => e.status === status);
    if (locale) entries = entries.filter((e) => e.locale === locale);
    if (q) entries = entries.filter((e) => e.key.toLowerCase().includes(String(q).toLowerCase()));
    if (issueType) {
      const badKeys = new Set(db.prepare('SELECT DISTINCT locale || \'::\' || entry_key AS k FROM quality_issues WHERE job_id=? AND issue_type=?')
        .all(job.id, issueType).map((r) => r.k));
      entries = entries.filter((e) => badKeys.has(`${e.locale}::${e.key}`));
    }
    const issues = db.prepare('SELECT * FROM quality_issues WHERE job_id = ? ORDER BY id').all(job.id);
    const commerce = getCommerceConfig(db);
    const T = translator(pickLang(req));
    res.json({
      sourceType: job.source_type || 'json',
      sourceUrl: job.source_url || null,
      scannedPages: job.scanned_pages || 0,
      scanMeta: job.scanned_note ? JSON.parse(job.scanned_note) : null,
      nonTranslatable: job.non_translatable ? JSON.parse(job.non_translatable) : null,
      quota: job.quota_snapshot ? JSON.parse(job.quota_snapshot) : null,
      lockedKeys: job.locked_keys ? JSON.parse(job.locked_keys) : [],
      lockedStrings: job.locked_strings || 0,
      fontConfig: job.font_config ? JSON.parse(job.font_config) : null,
      unlock: {
        label: commerce.unlockLabel || T('ws.unlockBtn'),
        url: commerce.contactUrl,
        paymentEnabled: !!commerce.paymentEnabled,
        note: commerce.quoteNote || T('ws.unlockNote'),
      },
      job: {
        id: job.id, status: job.status, filename: job.filename,
        totalStrings: job.total_strings, translatedStrings: job.translated_strings,
        failedStrings: job.failed_strings, model: job.model,
        tokenUsage: job.token_usage, estimatedCost: job.estimated_cost,
        createdAt: job.created_at,
      },
      project: {
        id: project.id, name: project.project_name,
        sourceLanguage: project.source_language,
        targetLanguages: JSON.parse(project.target_languages),
        productType: project.product_type, context: project.context, style: project.style,
      },
      entries: entries.map((e) => ({
        id: e.id, locale: e.locale, key: e.key,
        sourceText: e.source_text, translatedText: e.translated_text,
        manuallyEdited: !!e.manually_edited, status: e.status,
        sourceChars: (e.source_text || '').length,
        translatedChars: (e.translated_text || '').length,
      })),
      access: access.via,
      readOnly: access.via !== 'owner',
      // Only the owner receives the token; a share link cannot re-share.
      shareToken: access.via === 'owner' ? job.share_token : undefined,
      qualityIssues: issues.map((i) => ({
        entryKey: i.entry_key, locale: i.locale, issueType: i.issue_type,
        severity: i.severity, description: i.description, suggestion: i.suggestion,
      })),
    });
  });

  // Manual edit of one entry (protected from overwrite afterwards).
  r.patch('/api/translate/entries/:id', (req, res) => {
    const e = db.prepare('SELECT * FROM translation_entries WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Entry not found.' });
    if (!ownsJob(db, req, e.job_id)) return res.status(403).json({ error: 'Forbidden.' });
    const { translatedText, status } = req.body || {};
    const allowed = ['completed', 'needs_review', 'approved', 'skipped'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    db.prepare(`UPDATE translation_entries SET translated_text=COALESCE(?, translated_text),
      manually_edited=CASE WHEN ? IS NOT NULL THEN 1 ELSE manually_edited END,
      status=COALESCE(?, status), modified_at=? WHERE id=?`)
      .run(translatedText ?? null, translatedText ?? null, status ?? null, new Date().toISOString(), e.id);
    res.json({ ok: true });
  });

  // Retranslate one entry. Manual edits are never overwritten without force.
  r.post('/api/translate/entries/:id/retranslate', async (req, res) => {
    const e = db.prepare('SELECT * FROM translation_entries WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Entry not found.' });
    if (!ownsJob(db, req, e.job_id)) return res.status(403).json({ error: 'Forbidden.' });
    const force = req.body?.force === true;
    if (e.manually_edited && !force) {
      return res.status(409).json({
        error: 'This entry was manually edited. Confirm overwrite to retranslate.',
        requiresForce: true,
      });
    }
    const job = db.prepare('SELECT * FROM translation_jobs WHERE id = ?').get(e.job_id);
    const project = db.prepare('SELECT * FROM translation_projects WHERE id = ?').get(job.project_id);
    const glossary = db.prepare('SELECT * FROM glossaries WHERE project_id = ? AND locale = ?').all(project.id, e.locale);
    try {
      const { translations, failures } = await translateEntries([{ key: e.key, value: e.source_text }], {
        sourceLang: project.source_language, targetLang: e.locale,
        productType: project.product_type, context: project.context,
        style: project.style, extra: project.extra_requirements,
        brandTerms: JSON.parse(project.brand_terms || '[]'),
        glossary: glossary.map((g) => ({ sourceTerm: g.source_term, targetTerm: g.target_term })),
        batchSize: 1,
      });
      if (!translations.has(e.key)) {
        return res.status(502).json({ error: failures[0]?.error || 'Retranslate failed.' });
      }
      db.prepare("UPDATE translation_entries SET translated_text=?, status='completed', manually_edited=0, modified_at=? WHERE id=?")
        .run(translations.get(e.key), new Date().toISOString(), e.id);
      res.json({ ok: true, translatedText: translations.get(e.key) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Run QA checks for the whole job (programmatic; stores quality_issues).
  r.post('/api/translate/jobs/:id/qa', (req, res) => {
    const job = getOwnedJob(db, req, res);
    if (!job) return;
    const project = db.prepare('SELECT * FROM translation_projects WHERE id = ?').get(job.project_id);
    const sourceJson = JSON.parse(job.source_file);
    const sourceParsed = parseTranslatable(sourceJson);
    const glossaryRows = db.prepare('SELECT * FROM glossaries WHERE project_id = ?').all(project.id);
    const locales = JSON.parse(project.target_languages);

    db.prepare('DELETE FROM quality_issues WHERE job_id = ?').run(job.id);
    const insert = db.prepare(`INSERT INTO quality_issues
      (job_id, entry_key, locale, issue_type, severity, description, suggestion, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    let count = 0;

    for (const locale of locales) {
      const rows = db.prepare('SELECT * FROM translation_entries WHERE job_id=? AND locale=?').all(job.id, locale);
      const translations = {};
      for (const row of rows) if (row.translated_text) translations[row.key] = row.translated_text;
      const translatedJson = rebuildJson(sourceJson, translations);
      const translatedParsed = parseTranslatable(translatedJson);

      const fileIssues = quality.checkFile(sourceJson, translatedJson, sourceParsed, translatedParsed);
      const entryIssues = quality.checkEntries(
        rows.map((r) => ({ key: r.key, sourceText: r.source_text, translatedText: r.translated_text || '' })),
        {
          targetLang: locale,
          glossary: glossaryRows.filter((g) => g.locale === locale)
            .map((g) => ({ sourceTerm: g.source_term, targetTerm: g.target_term })),
        });

      for (const i of [...fileIssues, ...entryIssues]) {
        insert.run(job.id, i.entryKey, locale, i.issueType, i.severity, i.description, i.suggestion, new Date().toISOString());
        count++;
      }
      // Flag affected entries for workspace display.
      db.prepare(`UPDATE translation_entries SET status='needs_review'
        WHERE job_id=? AND locale=? AND status='completed'
        AND key IN (SELECT entry_key FROM quality_issues WHERE job_id=? AND locale=? AND severity IN ('high','medium'))`)
        .run(job.id, locale, job.id, locale);
    }
    res.json({ ok: true, issueCount: count });
  });

  // Export: format = json | zip | csv | report ; locale required for json.
  r.get('/api/translate/jobs/:id/export', (req, res) => {
    const access = getReadableJob(db, req, res);
    if (!access) return;
    const { job } = access;
    const project = db.prepare('SELECT * FROM translation_projects WHERE id = ?').get(job.project_id);
    const format = req.query.format || 'zip';
    const sourceJson = JSON.parse(job.source_file);
    const locales = JSON.parse(project.target_languages);
    const filename = job.filename || 'common.json';

    const localeData = {};
    const rows = db.prepare('SELECT * FROM translation_entries WHERE job_id=?').all(job.id);
    for (const locale of locales) {
      const translations = {};
      for (const row of rows.filter((r) => r.locale === locale)) {
        if (row.translated_text != null) translations[row.key] = row.translated_text;
      }
      // Validate before export: structure must mirror source exactly.
      const out = rebuildJson(sourceJson, translations);
      const problems = verifyStructure(sourceJson, out);
      if (problems.length) {
        return res.status(500).json({ error: `Export blocked: structure validation failed for ${locale}.`, problems });
      }
      localeData[locale] = out;
    }

    if (format === 'package') {
      const cfg = { fonts: getFontsConfig(db), commerce: getCommerceConfig(db) };
      let selections = [];
      if (job.font_config) {
        try { selections = JSON.parse(job.font_config).selections || []; } catch { /* ignore */ }
      }
      if (!selections.length && req.query.fontId) {
        selections = [{ lang: locales[0], fontId: String(req.query.fontId) }];
      }
      const fontConfigs = [];
      for (const sel of selections) {
        const lang = fonts.normalizeLocale(sel.lang);
        if (!locales.includes(lang) && !locales.includes(String(sel.lang))) continue;
        const f = fonts.findFont(sel.fontId, cfg);
        if (!f || !fonts.covers(f, fonts.requiredScripts(lang))) continue;
        if (!fonts.licenseAllows(f, 'config')) continue;
        fontConfigs.push({ font: fonts.publicFont(f), config: fonts.buildConfigCss(lang, f, cfg) });
      }
      const manifest = {
        sourceType: job.source_type || 'json',
        locales,
        totalTranslatableStrings: job.total_strings,
        translatedEntries: rows.filter((r) => r.translated_text != null).length,
        lockedStrings: job.locked_strings || 0,
        lockedKeys: job.locked_keys ? JSON.parse(job.locked_keys) : [],
        quota: job.quota_snapshot ? JSON.parse(job.quota_snapshot) : null,
        note: 'Keys not translated within the Free quota are exported as ORIGINAL source text. The translated free portion is fully downloadable.',
      };
      const locFiles = locales.map((l) => ({ locale: l, content: JSON.stringify(localeData[l], null, 2) + '\n' }));
      const files = fonts.buildLocalizationPackage({ locales: locFiles, fontConfigs, manifest, cfg });
      return streamZip(res, files, 'localization-package.zip');
    }

    if (format === 'json') {
      const locale = req.query.locale;
      if (!locale || !localeData[locale]) return res.status(400).json({ error: 'locale parameter required (json format).' });
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${locale}.${filename}"`);
      return res.send(JSON.stringify(localeData[locale], null, 2) + '\n');
    }

    if (format === 'csv') {
      const byKey = {};
      for (const row of rows) {
        byKey[row.key] ||= { source: row.source_text };
        byKey[row.key][row.locale] = row.translated_text;
      }
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="translations.csv"');
      return res.send(buildCsv(byKey, locales));
    }

    if (format === 'report') {
      const issues = db.prepare('SELECT * FROM quality_issues WHERE job_id=?').all(job.id);
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      res.setHeader('content-disposition', 'attachment; filename="qa-report.md"');
      return res.send(buildQaReport(job, issues, null));
    }

    // default: zip bundle with locales/<lang>/<filename> + QA report + CSV
    const byKey = {};
    for (const row of rows) {
      byKey[row.key] ||= { source: row.source_text };
      byKey[row.key][row.locale] = row.translated_text;
    }
    const issues = db.prepare('SELECT * FROM quality_issues WHERE job_id=?').all(job.id);
    const files = [
      ...locales.map((l) => ({ path: `locales/${l}/${filename}`, content: JSON.stringify(localeData[l], null, 2) + '\n' })),
      { path: 'translations.csv', content: buildCsv(byKey, locales) },
      { path: 'qa-report.md', content: buildQaReport(job, issues, null) },
    ];
    streamZip(res, files, 'locales.zip');
  });

  // Save optional font selections for a job. Fonts are INDEPENDENT of the
  // JSON translation: a user may download only the locale files, or additionally
  // request a font config / localization package.
  r.post('/api/translate/jobs/:id/fonts', (req, res) => {
    const job = getOwnedJob(db, req, res);
    if (!job) return;
    const cfg = { fonts: getFontsConfig(db), commerce: getCommerceConfig(db) };
    const project = db.prepare('SELECT target_languages FROM translation_projects WHERE id = ?').get(job.project_id);
    const targets = JSON.parse(project.target_languages);
    const input = Array.isArray(req.body?.selections) ? req.body.selections : [];
    const cleaned = [];
    const seen = new Set();
    for (const sel of input) {
      const lang = fonts.normalizeLocale(sel.lang);
      if (!targets.includes(lang) && !targets.includes(String(sel.lang))) continue;
      const f = fonts.findFont(sel.fontId, cfg);
      if (!f || !fonts.covers(f, fonts.requiredScripts(lang)) || !fonts.licenseAllows(f, 'config')) continue;
      const k = lang + '::' + f.id;
      if (seen.has(k)) continue;
      seen.add(k);
      cleaned.push({ lang, fontId: f.id });
    }
    db.prepare('UPDATE translation_jobs SET font_config=? WHERE id=?')
      .run(JSON.stringify({ selections: cleaned, updatedAt: new Date().toISOString() }), job.id);
    res.json({ ok: true, selections: cleaned });
  });

  return r;
};

function getOwnedJob(db, req, res) {
  const job = db.prepare('SELECT * FROM translation_jobs WHERE id = ?').get(req.params.id);
  const T = translator(pickLang(req));
  if (!job) { res.status(404).json({ error: T('err.jobNotFound') }); return null; }
  if (!ownsJob(db, req, job.id, job)) { res.status(403).json({ error: T('err.readOnlyShare') }); return null; }
  return job;
}

function newShareToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return require('crypto').timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

/** Owner session OR valid read-only share token (?t= or x-share-token). */
function getReadableJob(db, req, res) {
  const job = db.prepare('SELECT * FROM translation_jobs WHERE id = ?').get(req.params.id);
  const T = translator(pickLang(req));
  if (!job) { res.status(404).json({ error: T('err.jobNotFound') }); return null; }
  if (ownsJob(db, req, job.id, job)) return { job, via: 'owner' };
  const token = req.query.t || req.get('x-share-token');
  if (token && job.share_token && safeEqual(String(token), job.share_token)) {
    return { job, via: 'share' };
  }
  res.status(403).json({
    error: T('err.jobNoAccess'),
    hint: T('err.jobNoAccessHint'),
  });
  return null;
}

function ownsJob(db, req, jobId, job = null) {
  job = job || db.prepare('SELECT * FROM translation_jobs WHERE id = ?').get(jobId);
  if (!job) return false;
  const project = db.prepare('SELECT user_id, anon_id FROM translation_projects WHERE id = ?').get(job.project_id);
  if (!project) return false;
  if (project.user_id) return project.user_id === req.userId;
  return project.anon_id === req.anonId;
}
