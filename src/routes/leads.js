'use strict';
// Professional human translation service — lead capture + admin view.
// MVP: requirement submission, lead storage, admin listing.
// No auto-dispatch, no fake translator claims, pricing confirmed by humans.

const express = require('express');
const crypto = require('crypto');
const config = require('../config');

const SERVICE_TYPES = [
  'Review Existing Translations',
  'Fix Translation Errors',
  'Full Professional Localization',
  'SaaS UI Copywriting',
  'Other',
];

module.exports = function leadRoutes(db) {
  const r = express.Router();

  r.post('/api/leads', (req, res) => {
    try {
      const {
        auditJobId, email, productName, targetLanguages,
        serviceType, estimatedWordCount, description, needsHumanReview,
      } = req.body || {};

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid contact email is required.' });
      }
      const targets = Array.isArray(targetLanguages) ? targetLanguages.filter(Boolean) : [];
      if (!targets.length) return res.status(400).json({ error: 'At least one target language is required.' });
      if (!SERVICE_TYPES.includes(serviceType)) {
        return res.status(400).json({ error: `serviceType must be one of: ${SERVICE_TYPES.join(', ')}` });
      }

      // Link the diagnostic context when coming from a report.
      let auditContext = null;
      if (auditJobId) {
        const job = db.prepare('SELECT * FROM audit_jobs WHERE id = ?').get(auditJobId);
        if (job) {
          auditContext = JSON.stringify({
            auditJobId: job.id,
            websiteUrl: job.website_url,
            targetLanguage: job.target_language,
            localizationScore: job.localization_score,
            issueCount: job.issue_count,
            scannedPages: job.scanned_pages,
          });
        }
      }

      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO human_service_leads
        (id, audit_job_id, email, product_name, target_languages, service_type,
         estimated_word_count, description, needs_human_review, audit_context, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`)
        .run(id, auditJobId || null, email, productName || null, JSON.stringify(targets),
          serviceType, Number.isFinite(+estimatedWordCount) ? +estimatedWordCount : null,
          description || null, needsHumanReview ? 1 : 0, auditContext, new Date().toISOString());

      res.status(201).json({
        id,
        message: 'Request received. Our localization team will review your requirements and contact you by email with a scope assessment and quote. No translator is assigned until details are confirmed with you.',
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: list leads (token protected).
  r.get('/api/admin/leads', (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const status = req.query.status;
    let rows = db.prepare('SELECT * FROM human_service_leads ORDER BY created_at DESC').all();
    if (status) rows = rows.filter((x) => x.status === status);
    res.json({
      leads: rows.map((x) => ({
        id: x.id, email: x.email, productName: x.product_name,
        targetLanguages: JSON.parse(x.target_languages || '[]'),
        serviceType: x.service_type, estimatedWordCount: x.estimated_word_count,
        description: x.description, needsHumanReview: !!x.needs_human_review,
        auditContext: x.audit_context ? JSON.parse(x.audit_context) : null,
        status: x.status, createdAt: x.created_at,
      })),
    });
  });

  // Admin: update lead status.
  r.patch('/api/admin/leads/:id', (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized.' });
    const allowed = ['new', 'contacted', 'quoted', 'won', 'lost'];
    const { status } = req.body || {};
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const n = db.prepare('UPDATE human_service_leads SET status=? WHERE id=?').run(status, req.params.id);
    if (!n.changes) return res.status(404).json({ error: 'Lead not found.' });
    res.json({ ok: true });
  });

  return r;
};

function checkAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return token && token === config.adminToken;
}
