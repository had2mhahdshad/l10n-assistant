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
const { remainingTranslateQuota } = require('../lib/quota');

const SUPPORTED_TARGETS = ['ja', 'de', 'fr'];
const SUPPORTED_SOURCES = ['en', 'zh', 'zh-CN'];

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

  // Create project + job from pasted/uploaded JSON. Returns job id.
  r.post('/api/translate/jobs', (req, res) => {
    try {
      const {
        projectName, sourceLanguage, targetLanguages, json, filename,
        productType, context, style, extra, brandTerms = [], glossary = [],
        ignoreKeys = [],
      } = req.body || {};

      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return res.status(400).json({ error: 'json must be a JSON object (locale file).' });
      }
      if (!SUPPORTED_SOURCES.includes(sourceLanguage)) {
        return res.status(400).json({ error: `Source language must be one of: ${SUPPORTED_SOURCES.join(', ')}` });
      }
      const targets = (Array.isArray(targetLanguages) ? targetLanguages : []).filter((t) => SUPPORTED_TARGETS.includes(t));
      if (!targets.length) {
        return res.status(400).json({ error: `Target languages must include at least one of: ${SUPPORTED_TARGETS.join(', ')}` });
      }

      const ignoreRules = (Array.isArray(ignoreKeys) ? ignoreKeys : []).map((p) => {
        try { return new RegExp(p); } catch { return null; }
      }).filter(Boolean);
      const entries = parseTranslatable(json, { ignoreRules });
      const st = jsonStats(entries);
      if (st.translatable === 0) {
        return res.status(400).json({ error: 'No translatable strings found in this file.' });
      }

      // Quota (module-independent).
      const remaining = remainingTranslateQuota(db, { userId: req.userId, anonId: req.anonId });
      const billableStrings = st.translatable * targets.length;
      if (billableStrings > remaining) {
        return res.status(429).json({
          error: `Free quota exceeded: this job needs ${billableStrings} strings (${st.translatable} × ${targets.length} locales) but only ${remaining} remain.`,
          code: 'QUOTA_EXCEEDED', remaining,
        });
      }

      const projectId = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO translation_projects
        (id, user_id, anon_id, project_name, source_language, target_languages, product_type, context, style, extra_requirements, brand_terms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(projectId, req.userId, req.anonId, projectName || 'Untitled project', sourceLanguage,
          JSON.stringify(targets), productType || null, context || null, style || 'product-neutral',
          extra || null, JSON.stringify(brandTerms), now);
      db.prepare(`INSERT INTO translation_jobs
        (id, project_id, anon_id, source_file, filename, status, total_strings, created_at, share_token)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
        .run(jobId, projectId, req.anonId, JSON.stringify(json), filename || 'common.json', st.translatable, now, newShareToken());
      insertGlossary(projectId, glossary);

      // Pre-create entry rows (pending) for every locale × translatable key.
      const ins = db.prepare(`INSERT INTO translation_entries
        (job_id, locale, key, path, source_text, status) VALUES (?, ?, ?, ?, ?, 'pending')`);
      for (const locale of targets) {
        for (const e of entries.filter((x) => x.translatable)) {
          ins.run(jobId, locale, e.key, JSON.stringify(e.path), e.value);
        }
      }

      res.status(201).json({
        jobId, projectId,
        stats: { ...st, billableStrings, quotaRemainingAfter: remaining - billableStrings },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Run translation for a job (all locales, or one locale via ?locale=).
  r.post('/api/translate/jobs/:id/run', async (req, res) => {
    const job = getOwnedJob(db, req, res);
    if (!job) return;
    const onlyLocale = req.query.locale || null;
    const force = req.query.force === '1';

    const project = db.prepare('SELECT * FROM translation_projects WHERE id = ?').get(job.project_id);
    const sourceJson = JSON.parse(job.source_file);
    const parsed = parseTranslatable(sourceJson);
    const translatable = parsed.filter((e) => e.translatable);
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
        const toTranslate = force
          ? translatable
          : translatable.filter((e) => !manualKeys.has(`${locale}::${e.key}`));
        const skipped = translatable.length - toTranslate.length;

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
        if (skipped) doneCount += 0; // skipped entries keep their manual text
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
    res.json({
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

  return r;
};

function getOwnedJob(db, req, res) {
  const job = db.prepare('SELECT * FROM translation_jobs WHERE id = ?').get(req.params.id);
  if (!job) { res.status(404).json({ error: 'Job not found.' }); return null; }
  if (!ownsJob(db, req, job.id, job)) { res.status(403).json({ error: 'Forbidden.' }); return null; }
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
  if (!job) { res.status(404).json({ error: 'Job not found.' }); return null; }
  if (ownsJob(db, req, job.id, job)) return { job, via: 'owner' };
  const token = req.query.t || req.get('x-share-token');
  if (token && job.share_token && safeEqual(String(token), job.share_token)) {
    return { job, via: 'share' };
  }
  res.status(403).json({
    error: 'You do not have access to this job.',
    hint: 'Use the share link provided by the project owner, or start your own translation.',
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
