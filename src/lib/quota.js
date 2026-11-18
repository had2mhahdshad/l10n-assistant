'use strict';
// Usage quotas. Free Checker and AI Translation are metered INDEPENDENTLY.
// Anonymous devices are identified by a signed-ish random cookie id.

const crypto = require('crypto');
const config = require('../config');

function newAnonId() {
  return 'anon_' + crypto.randomBytes(16).toString('hex');
}

/** Extract/assign anonymous id from cookies. Returns { anonId, setCookie } */
function resolveAnonId(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.l10n_anon && /^anon_[a-f0-9]{32}$/.test(cookies.l10n_anon)) {
    return { anonId: cookies.l10n_anon, setCookie: null };
  }
  const anonId = newAnonId();
  return {
    anonId,
    setCookie: `l10n_anon=${anonId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`,
  };
}

function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Check & consume one free-audit credit. Throws QuotaError when exceeded. */
function consumeAuditQuota(db, { userId, anonId }) {
  if (userId) {
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const row = db.prepare(
      "SELECT COUNT(*) AS n FROM audit_jobs WHERE user_id = ? AND created_at >= ?"
    ).get(userId, monthStart.toISOString());
    if (row.n >= config.quota.userAuditMonthly) {
      throw new QuotaError(`Monthly free check limit reached (${config.quota.userAuditMonthly}).`);
    }
    return;
  }
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM audit_jobs WHERE anon_id = ? AND user_id IS NULL AND created_at >= ?"
  ).get(anonId, dayStart.toISOString());
  if (row.n >= config.quota.anonAuditDaily) {
    throw new QuotaError(`Daily free check limit reached (${config.quota.anonAuditDaily}/day per device). Please try again tomorrow or sign in.`);
  }
}

/** Remaining free translation strings for a user/device. */
function remainingTranslateQuota(db, { userId, anonId }) {
  const where = userId ? 'tp.user_id = ?' : 'tj.anon_id = ? AND tp.user_id IS NULL';
  const arg = userId || anonId;
  const row = db.prepare(
    `SELECT COALESCE(SUM(tj.total_strings), 0) AS used
     FROM translation_jobs tj JOIN translation_projects tp ON tp.id = tj.project_id
     WHERE ${where}`
  ).get(arg);
  const used = row.used || 0;
  return Math.max(0, config.quota.freeTranslateStrings - used);
}

class QuotaError extends Error {
  constructor(msg) { super(msg); this.code = 'QUOTA_EXCEEDED'; this.status = 429; }
}

module.exports = { resolveAnonId, consumeAuditQuota, remainingTranslateQuota, QuotaError, parseCookies };
