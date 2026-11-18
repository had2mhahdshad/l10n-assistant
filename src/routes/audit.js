'use strict';
// Localization Checker API — free diagnostic module.
// Independent from the AI Translation module: own jobs, own quota.

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { runWebsiteAudit, runJsonAudit, severityDistribution, typeDistribution } = require('../lib/checker/runAudit');
const { consumeAuditQuota, QuotaError } = require('../lib/quota');
const { pickLang, translator } = require('../lib/i18n');
const { getQuotaConfig } = require('../lib/settings');

const SUPPORTED = ['en', 'zh', 'zh-CN', 'ja', 'de', 'fr'];

/** Read-only share tokens: a link may be handed to a colleague/客户 without
 *  transferring the owner's session. Never grants write access. */
function newShareToken() {
  return crypto.randomBytes(16).toString('hex');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

/** Owner (session) OR a valid share token in ?t= / x-share-token. */
function canReadAudit(job, req) {
  const owned = job.user_id ? job.user_id === req.userId : job.anon_id === req.anonId;
  if (owned) return { ok: true, via: 'owner' };
  const token = req.query.t || req.get('x-share-token');
  if (token && job.share_token && safeEqual(String(token), job.share_token)) {
    return { ok: true, via: 'share' };
  }
  return { ok: false };
}

module.exports = function auditRoutes(db) {
  const r = express.Router();

  // Start a website audit.
  r.post('/api/audit', async (req, res) => {
    try {
      const { websiteUrl, targetUrl, sourceLanguage, targetLanguage } = req.body || {};
      if (!websiteUrl || !sourceLanguage || !targetLanguage) {
        return res.status(400).json({ error: 'websiteUrl, sourceLanguage and targetLanguage are required.' });
      }
      if (!SUPPORTED.includes(sourceLanguage) || !SUPPORTED.includes(targetLanguage)) {
        return res.status(400).json({ error: `Supported languages: ${SUPPORTED.join(', ')}` });
      }
      consumeAuditQuota(db, { userId: req.userId, anonId: req.anonId });

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const shareToken = newShareToken();
      db.prepare(`INSERT INTO audit_jobs
        (id, user_id, anon_id, website_url, target_url, source_language, target_language, status, created_at, share_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`)
        .run(id, req.userId, req.anonId, websiteUrl, targetUrl || null, sourceLanguage, targetLanguage, now, shareToken);

      try {
        const result = await runWebsiteAudit(
          { websiteUrl, targetUrl, sourceLanguage, targetLanguage }, db, id);
        persistResult(db, id, result);
        return res.json({ id, status: 'completed' });
      } catch (err) {
        console.error('[audit:website]', err);
        const msg = err.clientMessage || 'Scan failed unexpectedly.';
        db.prepare("UPDATE audit_jobs SET status='failed', error=?, completed_at=? WHERE id=?")
          .run(msg, new Date().toISOString(), id);
        return res.status(err.status || 500).json({
          error: msg, id, needsTargetUrl: !!err.needsTargetUrl,
          detail: config.env === 'development' ? err.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
        });
      }
    } catch (err) {
      return handleErr(res, err);
    }
  });

  // JSON content audit (complete content check on uploaded files).
  r.post('/api/audit/json', async (req, res) => {
    try {
      const { sourceJson, targetJson, sourceLanguage, targetLanguage, websiteUrl } = req.body || {};
      if (!sourceJson || typeof sourceJson !== 'object') {
        return res.status(400).json({ error: 'sourceJson (object) is required.' });
      }
      if (!SUPPORTED.includes(sourceLanguage) || !SUPPORTED.includes(targetLanguage)) {
        return res.status(400).json({ error: `Supported languages: ${SUPPORTED.join(', ')}` });
      }
      consumeAuditQuota(db, { userId: req.userId, anonId: req.anonId });

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const shareToken = newShareToken();
      db.prepare(`INSERT INTO audit_jobs
        (id, user_id, anon_id, website_url, source_language, target_language, status, created_at, share_token)
        VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`)
        .run(id, req.userId, req.anonId, websiteUrl || '(json upload)', sourceLanguage, targetLanguage, now, shareToken);

      try {
        const result = await runJsonAudit({ sourceJson, targetJson: targetJson || null, sourceLanguage, targetLanguage }, db);
        persistResult(db, id, result);
        return res.json({ id, status: 'completed' });
      } catch (err) {
        db.prepare("UPDATE audit_jobs SET status='failed', error=?, completed_at=? WHERE id=?")
          .run(err.message, new Date().toISOString(), id);
        return res.status(500).json({ error: 'Audit failed: ' + err.message, id });
      }
    } catch (err) {
      return handleErr(res, err);
    }
  });

  // Fetch an audit report. Ownership check: anon id or user must match.
  r.get('/api/audit/:id', (req, res) => {
    const lang = pickLang(req);
    const T = translator(lang);
    const job = db.prepare('SELECT * FROM audit_jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: T('err.auditNotFound') });
    const access = canReadAudit(job, req);
    if (!access.ok) {
      return res.status(403).json({
        error: T('err.noAccess'),
        hint: T('err.noAccessHint'),
      });
    }
    const issues = db.prepare('SELECT * FROM audit_issues WHERE audit_job_id = ? ORDER BY CASE severity WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 ELSE 2 END, id')
      .all(req.params.id);

    const full = getQuotaConfig(db).freeReportFullExamples;
    const examples = issues.slice(0, full).map((i) => publicIssue(i, lang));
    const summaries = issues.slice(full).map((i) => ({
      issueType: i.issue_type, severity: i.severity, pageUrl: i.page_url, context: i.context,
      excerpt: truncate(i.current_translation || i.source_text || '', 80),
    }));

    res.json({
      id: job.id,
      access: access.via,
      // Only the owner gets the share token back; a share link cannot re-share.
      shareToken: access.via === 'owner' ? job.share_token : undefined,
      status: job.status,
      error: job.error,
      websiteUrl: job.website_url === '(json upload)' ? T('rep.uploadedJson') : job.website_url,
      // Raw URL kept separately so the UI can render a clickable link.
      websiteUrlRaw: job.website_url !== '(json upload)' ? job.website_url : null,
      targetUrl: job.target_url,
      sourceLanguage: job.source_language,
      targetLanguage: job.target_language,
      score: job.localization_score,
      dimensions: job.score_dimensions ? JSON.parse(job.score_dimensions) : null,
      issueCount: job.issue_count,
      severityDist: job.severity_dist ? JSON.parse(job.severity_dist) : null,
      typeDist: job.type_dist ? JSON.parse(job.type_dist) : null,
      scannedPages: job.scanned_pages,
      failedPages: job.failed_pages,
      discoveredPages: job.discovered_pages,
      failedList: job.coverage_note ? undefined : undefined,
      coverageNote: job.scanned_pages > 0 ? T('note.webScope') : T('note.jsonScope'),
      targetVia: job.target_url && job.website_url === '(json upload)' ? 'json-upload' : null,
      sampleSize: job.sample_size,
      aiDegraded: !!job.ai_degraded,
      nonTranslatable: job.non_translatable ? JSON.parse(job.non_translatable) : null,
      freeExamples: examples,
      summaries,
      fullExamplesShown: examples.length,
      paywallNote: T('note.paywall'),
      createdAt: job.created_at,
    });
  });

  return r;
};

function persistResult(db, id, result) {
  const sev = severityDistribution(result.issues);
  const typ = typeDistribution(result.issues);
  const insert = db.prepare(`INSERT INTO audit_issues
    (audit_job_id, issue_type, severity, source_text, current_translation, suggestion, reason, page_url, context, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const i of result.issues) {
    insert.run(id, i.issueType, i.severity, i.sourceText || null, i.currentTranslation || null,
      i.suggestion || null, i.reason || null, i.pageUrl || null, i.context || null, i.source || 'rule');
  }
  db.prepare(`UPDATE audit_jobs SET
      status='completed', scanned_pages=?, failed_pages=?, discovered_pages=?,
      coverage_note=?, target_url=COALESCE(?, target_url), localization_score=?,
      score_dimensions=?, issue_count=?, severity_dist=?, type_dist=?, sample_size=?,
      ai_degraded=?, non_translatable=?, completed_at=?
    WHERE id=?`)
    .run(result.scannedPages, result.failedPages, result.discoveredPages,
      result.coverageNote, result.targetUrl || null, result.score.overall,
      JSON.stringify(result.score.dimensions), result.issues.length,
      JSON.stringify(sev), JSON.stringify(typ), result.sampleSize,
      result.aiDegraded ? 1 : 0,
      result.nonTranslatable ? JSON.stringify(result.nonTranslatable) : null,
      new Date().toISOString(), id);
}

function publicIssue(i, lang = 'en') {
  return {
    issueType: i.issue_type,
    severity: i.severity,
    sourceText: i.source_text,
    currentTranslation: i.current_translation,
    // Direction only, never a full fixed translation.
    suggestion: localizeSuggestion(i, lang),
    suggestionEn: i.suggestion,
    reason: i.reason,
    pageUrl: i.page_url,
    context: i.context,
  };
}

/**
 * Issue directions are generated by the rule engine in English. The specific
 * detail (variable names, percentages, URLs) is carried in the tail after the
 * first colon, so the Chinese rendering reuses it instead of re-deriving it.
 */
function localizeSuggestion(issue, lang) {
  if (lang !== 'zh') return issue.suggestion;
  const raw = String(issue.suggestion || '');
  const idx = raw.indexOf(': ');
  const tail = idx >= 0 ? raw.slice(idx + 2) : '';
  switch (issue.issue_type) {
    case 'missing_translation':
      return '这段文字仍是源语言，疑似从未翻译。';
    case 'placeholder':
      return `译文中动态变量丢失或损坏${tail ? '：' + tail : ''}。`;
    case 'html_integrity':
      return '源文与译文的 HTML 结构不一致，标记可能已损坏。';
    case 'url_change':
      return `译文中的 URL 发生变化${tail ? '：' + tail : ''}。`;
    case 'terminology':
      return '同一段源文在不同页面出现了多种译法，建议统一为一种标准译法。';
    case 'ui_length':
      return `译文长度相对原文明显变化（仅为长度风险估算，不是真实渲染检测）${tail ? '：' + tail : ''}。`;
    case 'cultural':
      return `可能存在本地化缺口${tail ? '：' + tail : ''}。请确认格式符合目标市场习惯。`;
    case 'unnatural':
      return '表达不符合目标语言的母语习惯。';
    case 'semantic_error':
      return '译文与原文含义存在偏差。';
    case 'grammar':
      return '译文中存在语法或拼写问题。';
    case 'language_mismatch':
      return '译文语言与目标语言不一致。';
    default:
      return raw;
  }
}

function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

function handleErr(res, err) {
  if (err instanceof QuotaError || err.code === 'QUOTA_EXCEEDED') {
    return res.status(429).json({ error: err.message, code: 'QUOTA_EXCEEDED' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal error: ' + err.message });
}
