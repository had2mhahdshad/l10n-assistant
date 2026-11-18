'use strict';
// Admin settings API + runtime effect tests (isolated temp DB, mock AI).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l10n-settings-')), 'test.db');
process.env.AI_PROVIDER = 'mock';
process.env.ADMIN_TOKEN = 'settings-test-token';
process.env.FREE_AUDIT_DAILY_LIMIT_ANON = '0';
process.env.FREE_AUDIT_MONTHLY_LIMIT_USER = '0';

const { createApp } = require('../src/server');

let server, base;
const ADMIN = { 'x-admin-token': 'settings-test-token', 'content-type': 'application/json' };

test.before(async () => {
  const { app } = createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

async function call(url, method, body, headers = ADMIN) {
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('settings API rejects requests without the admin token', async () => {
  const r = await call('/api/admin/settings', 'GET', undefined, {});
  assert.equal(r.status, 401);
});

test('public settings never expose the raw API key', async () => {
  const r = await call('/api/admin/settings', 'GET');
  assert.equal(r.status, 200);
  assert.equal(r.data.ai.apiKey, undefined);
  assert.equal(typeof r.data.ai.apiKeySet, 'boolean');
  assert.ok(r.data.scoring.dimensions.accuracy);
  assert.ok(r.data.quota);
});

test('saving an API key stores it but only returns a masked hint', async () => {
  const r = await call('/api/admin/settings', 'PUT', { ai: { apiKey: 'sk-secret-1234', provider: 'mock', model: 'custom-model' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.ai.apiKey, undefined);
  assert.equal(r.data.settings.ai.apiKeySet, true);
  assert.ok(r.data.settings.ai.apiKeyHint.includes('1234'));
  assert.equal(r.data.settings.ai.model, 'custom-model');

  // Leaving the key blank keeps the stored one.
  const r2 = await call('/api/admin/settings', 'PUT', { ai: { apiKey: '', model: 'another-model' } });
  assert.equal(r2.data.settings.ai.apiKeySet, true);
  assert.equal(r2.data.settings.ai.model, 'another-model');
});

test('AI provider honours the runtime model config', async () => {
  const { getAiConfig } = require('../src/lib/settings');
  assert.equal(getAiConfig().model, 'another-model');
  assert.equal(getAiConfig().apiKey, 'sk-secret-1234');
});

test('free checker has no cap by default; a configured cap still enforces', async () => {
  const { getDb } = require('../src/db');
  const { consumeAuditQuota, QuotaError } = require('../src/lib/quota');
  const db = getDb();
  // 0 => unlimited, many calls in a row must not throw.
  for (let i = 0; i < 8; i++) assert.doesNotThrow(() => consumeAuditQuota(db, { userId: null, anonId: 'anon_unlimited' }));

  await call('/api/admin/settings', 'PUT', { quota: { anonAuditDaily: 2 } });
  // consumeAuditQuota counts existing jobs; seed two to reach the cap.
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT INTO audit_jobs
    (id, anon_id, website_url, source_language, target_language, status, created_at)
    VALUES (?, ?, ?, 'en', 'ja', 'completed', ?)`);
  ins.run('seed-1', 'anon_limited', 'https://example.com', now);
  ins.run('seed-2', 'anon_limited', 'https://example.com', now);
  assert.throws(() => consumeAuditQuota(db, { userId: null, anonId: 'anon_limited' }), (e) => e instanceof QuotaError);
  // Another device is unaffected.
  assert.doesNotThrow(() => consumeAuditQuota(db, { userId: null, anonId: 'anon_other' }));
});

test('scoring preview reflects changed weights without persisting', async () => {
  const plain = await call('/api/admin/settings/preview', 'POST', { scoring: { dimensions: { accuracy: { weight: 0.3 } } } });
  const skewed = await call('/api/admin/settings/preview', 'POST', {
    scoring: { dimensions: { accuracy: { weight: 1 }, naturalness: { weight: 0 }, terminology: { weight: 0 }, placeholders: { weight: 0 }, uiLength: { weight: 0 } } },
  });
  assert.equal(plain.status, 200);
  assert.equal(skewed.status, 200);
  assert.notEqual(plain.data.overall, skewed.data.overall);
  // Nothing was persisted by a preview.
  const cur = await call('/api/admin/settings', 'GET');
  assert.equal(cur.data.scoring.dimensions.accuracy.weight, 0.3);
});

test('reset restores environment defaults', async () => {
  const r = await call('/api/admin/settings/reset', 'POST', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.quota.anonAuditDaily, 0);
  assert.equal(r.data.settings.ai.model, 'gpt-4o-mini');
  assert.equal(r.data.settings.ai.apiKeySet, false);
});

test('invalid config is rejected with 400', async () => {
  const r = await call('/api/admin/settings', 'PUT', { ai: { baseUrl: 'ftp://bad' } });
  assert.equal(r.status, 400);
  const r2 = await call('/api/admin/settings', 'PUT', { scoring: { dimensions: { accuracy: { weight: 0 }, naturalness: { weight: 0 }, terminology: { weight: 0 }, placeholders: { weight: 0 }, uiLength: { weight: 0 } } } });
  assert.equal(r2.status, 400);
});
