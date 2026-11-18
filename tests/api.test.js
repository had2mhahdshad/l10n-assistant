'use strict';
// End-to-end API tests against a real server instance with a temp database
// and the deterministic mock AI provider (no network required).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l10n-test-')), 'test.db');
process.env.AI_PROVIDER = 'mock';
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.FREE_AUDIT_DAILY_LIMIT_ANON = '4';

const { createApp } = require('../src/server');

let server, base, cookie;

test.before(async () => {
  const { app } = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${server.address().port}`;
  // capture anon cookie
  const res = await fetch(`${base}/api/health`);
  cookie = res.headers.get('set-cookie')?.split(';')[0] || '';
});

test.after(() => server && server.close());

const jsonHeaders = () => ({ 'content-type': 'application/json', cookie });

async function post(url, body, extraHeaders = {}) {
  const res = await fetch(base + url, { method: 'POST', headers: { ...jsonHeaders(), ...extraHeaders }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function get(url, extraHeaders = {}) {
  const res = await fetch(base + url, { headers: { cookie, ...extraHeaders } });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : await res.text() };
}

const SAMPLE_JSON = {
  nav: { home: 'Home', workspace: 'Workspace' },
  cta: { save: 'Save', delete: 'Delete', create: 'Create a new workspace' },
  greeting: 'Welcome {name}, you have {count} projects',
  meta: { docs: 'https://docs.example.com', version: 2 },
};

// ── AI Translation workflow ──────────────────────────────────────────────

let jobId;

test('create translation job parses and protects', async () => {
  const r = await post('/api/translate/jobs', {
    projectName: 'Test project',
    sourceLanguage: 'en',
    targetLanguages: ['ja', 'de'],
    json: SAMPLE_JSON,
    context: 'Project management SaaS',
    brandTerms: ['FlowBoard'],
  });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.jobId);
  assert.strictEqual(r.body.stats.translatable, 6);
  jobId = r.body.jobId;
});

test('rejects unsupported target language', async () => {
  const r = await post('/api/translate/jobs', {
    sourceLanguage: 'en', targetLanguages: ['es'], json: { a: 'Hello' },
  });
  assert.strictEqual(r.status, 400);
});

test('run translation completes with mock provider', async () => {
  const r = await post(`/api/translate/jobs/${jobId}/run`, {});
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.translated, 12); // 6 strings × 2 locales
  assert.strictEqual(r.body.failed, 0);
});

test('translations preserve structure, placeholders and urls', async () => {
  const r = await get(`/api/translate/jobs/${jobId}`);
  assert.strictEqual(r.status, 200);
  const entries = r.body.entries;
  assert.strictEqual(entries.length, 12);

  const greet = entries.find((e) => e.key === 'greeting' && e.locale === 'ja');
  assert.ok(greet.translatedText.includes('{name}'), greet.translatedText);
  assert.ok(greet.translatedText.includes('{count}'), greet.translatedText);

  // known mock glossary rendering
  const save = entries.find((e) => e.key === 'cta.save' && e.locale === 'de');
  assert.strictEqual(save.translatedText, 'Speichern');
});

test('export JSON preserves original structure exactly', async () => {
  const r = await get(`/api/translate/jobs/${jobId}/export?format=json&locale=ja`);
  assert.strictEqual(r.status, 200);
  const out = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
  assert.deepStrictEqual(Object.keys(out), Object.keys(SAMPLE_JSON));
  assert.strictEqual(out.meta.version, 2);                      // number preserved
  assert.strictEqual(out.meta.docs, 'https://docs.example.com'); // url untouched
  assert.deepStrictEqual(Object.keys(out.nav), ['home', 'workspace']);
});

test('manual edit is protected from batch retranslation', async () => {
  const list = await get(`/api/translate/jobs/${jobId}`);
  const entry = list.body.entries.find((e) => e.key === 'cta.delete' && e.locale === 'ja');
  const patch = await fetch(`${base}/api/translate/entries/${entry.id}`, {
    method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ translatedText: '手動修正テキスト' }),
  });
  assert.strictEqual(patch.status, 200);

  await post(`/api/translate/jobs/${jobId}/run`, {});
  const after = await get(`/api/translate/jobs/${jobId}`);
  const same = after.body.entries.find((e) => e.key === 'cta.delete' && e.locale === 'ja');
  assert.strictEqual(same.translatedText, '手動修正テキスト');
  assert.strictEqual(same.manuallyEdited, true);
});

test('single retranslate refuses to clobber manual edit without force', async () => {
  const list = await get(`/api/translate/jobs/${jobId}`);
  const entry = list.body.entries.find((e) => e.key === 'cta.delete' && e.locale === 'ja');
  const r = await post(`/api/translate/entries/${entry.id}/retranslate`, {});
  assert.strictEqual(r.status, 409);
  const r2 = await post(`/api/translate/entries/${entry.id}/retranslate`, { force: true });
  assert.strictEqual(r2.status, 200);
  assert.notStrictEqual(r2.body.translatedText, '手動修正テキスト');
});

test('QA detects issues and workspace reflects them', async () => {
  const r = await post(`/api/translate/jobs/${jobId}/qa`, {});
  assert.strictEqual(r.status, 200);
  assert.ok(typeof r.body.issueCount === 'number');
  const detail = await get(`/api/translate/jobs/${jobId}`);
  assert.ok(Array.isArray(detail.body.qualityIssues));
});

test('export zip streams a valid archive', async () => {
  const res = await fetch(`${base}/api/translate/jobs/${jobId}/export?format=zip`, { headers: { cookie } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 200);
  assert.strictEqual(buf.readUInt16LE(0), 0x4b50); // PK zip signature
});

test('export csv contains bilingual rows', async () => {
  const r = await get(`/api/translate/jobs/${jobId}/export?format=csv`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.includes('cta.save'));
  assert.ok(r.body.includes('Speichern'));
});

// ── Localization Checker (JSON audit path — no network) ──────────────────

test('json audit detects residue and placeholder loss, produces score', async () => {
  const r = await post('/api/audit/json', {
    sourceLanguage: 'en', targetLanguage: 'ja',
    sourceJson: { a: 'Create a new workspace', b: 'Welcome {name}', c: 'Save' },
    targetJson: { a: 'Create a new workspace', b: 'ようこそ', c: '保存' },
  });
  assert.strictEqual(r.status, 201 === r.status ? 201 : 200, JSON.stringify(r.body));
  const report = await get(`/api/audit/${r.body.id}?lang=en`);
  assert.strictEqual(report.status, 200);
  assert.ok(report.body.score != null && report.body.score < 100);
  assert.ok(report.body.issueCount >= 2); // residue + lost {name}
  assert.ok(report.body.freeExamples.length >= 1);
  assert.ok(report.body.coverageNote.includes('uploaded file'));
});

test('audit report enforces ownership (other device gets 403)', async () => {
  const r = await post('/api/audit/json', {
    sourceLanguage: 'en', targetLanguage: 'de',
    sourceJson: { a: 'Save' }, targetJson: { a: 'Speichern' },
  });
  const res = await fetch(`${base}/api/audit/${r.body.id}`, { headers: { cookie: 'l10n_anon=anon_00000000000000000000000000dead' } });
  assert.strictEqual(res.status, 403);
});

test('website audit validates url scheme (no javascript: urls)', async () => {
  const r = await post('/api/audit', {
    websiteUrl: 'javascript:alert(1)', sourceLanguage: 'en', targetLanguage: 'ja',
  });
  assert.ok([400, 422].includes(r.status));
});

// ── Leads & admin ────────────────────────────────────────────────────────

let auditIdForLead;

test('lead capture links audit context; admin can list', async () => {
  const audit = await post('/api/audit/json', {
    sourceLanguage: 'en', targetLanguage: 'fr',
    sourceJson: { a: 'Save' }, targetJson: { a: 'Enregistrer' },
  });
  auditIdForLead = audit.body.id;

  const lead = await post('/api/leads', {
    auditJobId: auditIdForLead,
    email: 'dev@example.com',
    targetLanguages: ['fr'],
    serviceType: 'Fix Translation Errors',
    estimatedWordCount: 1500,
    needsHumanReview: true,
  });
  assert.strictEqual(lead.status, 201, JSON.stringify(lead.body));
  assert.ok(lead.body.message.includes('confirm') || lead.body.message.includes('contact'));

  const denied = await get('/api/admin/leads');
  assert.strictEqual(denied.status, 401);
  const list = await get('/api/admin/leads', { 'x-admin-token': 'test-admin-token' });
  assert.strictEqual(list.status, 200);
  const found = list.body.leads.find((l) => l.auditContext && l.auditContext.auditJobId === auditIdForLead);
  assert.ok(found, 'lead should carry audit context');
  assert.strictEqual(found.auditContext.localizationScore != null, true);
});

test('lead validation rejects bad email', async () => {
  const r = await post('/api/leads', { email: 'nope', targetLanguages: ['ja'], serviceType: 'Other' });
  assert.strictEqual(r.status, 400);
});

// ── Quota ────────────────────────────────────────────────────────────────

test('anonymous audit quota is enforced per day', async () => {
  // fresh device identity → independent daily counter
  const freshCookie = 'l10n_anon=anon_1111111111111111111111111111abcd';
  let lastStatus = 200;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${base}/api/audit/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: freshCookie },
      body: JSON.stringify({
        sourceLanguage: 'en', targetLanguage: 'ja',
        sourceJson: { x: `String ${i}` }, targetJson: { x: `文字列 ${i}` },
      }),
    });
    lastStatus = res.status;
  }
  assert.strictEqual(lastStatus, 429); // env limit is 4/day in tests
});

// ── Read-only share links ────────────────────────────────────────────────
// A report / workspace can be handed to a colleague through ?t=<token>
// without giving away the owner's session, and without granting write access.

async function freshAnon() {
  const res = await fetch(`${base}/api/health`);
  return res.headers.get('set-cookie')?.split(';')[0] || '';
}
const withCookie = (c) => ({ 'content-type': 'application/json', cookie: c });

test('share link: audit report is readable read-only, writes stay blocked', async () => {
  const owner = await freshAnon();
  const created = await fetch(`${base}/api/audit/json`, {
    method: 'POST',
    headers: withCookie(owner),
    body: JSON.stringify({
      sourceLanguage: 'en', targetLanguage: 'ja',
      sourceJson: { a: 'Create a new workspace', b: 'Welcome back, {name}' },
      targetJson: { a: '新しい作業場を作る', b: 'おかえりなさい' },
    }),
  }).then((r) => r.json());
  assert.ok(created.id, 'audit created');

  // Owner sees the token; it is not exposed to shared viewers.
  const own = await fetch(`${base}/api/audit/${created.id}`, { headers: { cookie: owner } }).then((r) => r.json());
  assert.strictEqual(own.access, 'owner');
  assert.match(own.shareToken, /^[a-f0-9]{32}$/);

  // A different browser with the share token can read it.
  const shared = await fetch(`${base}/api/audit/${created.id}?t=${own.shareToken}`);
  assert.strictEqual(shared.status, 200);
  const sd = await shared.json();
  assert.strictEqual(sd.access, 'share');
  assert.strictEqual(sd.shareToken, undefined, 'share link must not be able to re-share');
  assert.strictEqual(sd.issueCount, own.issueCount);

  // No token, no session → denied.
  const denied = await fetch(`${base}/api/audit/${created.id}`);
  assert.strictEqual(denied.status, 403);

  // Wrong token → denied.
  const wrong = await fetch(`${base}/api/audit/${created.id}?t=${'0'.repeat(32)}`);
  assert.strictEqual(wrong.status, 403);
});

test('share link: workspace is read-only and cannot be edited', async () => {
  const owner = await freshAnon();
  const job = await fetch(`${base}/api/translate/jobs`, {
    method: 'POST',
    headers: withCookie(owner),
    body: JSON.stringify({ sourceLanguage: 'en', targetLanguages: ['ja'], json: SAMPLE_JSON }),
  }).then((r) => r.json());
  assert.ok(job.jobId, 'job created');

  const ownView = await fetch(`${base}/api/translate/jobs/${job.jobId}`, { headers: { cookie: owner } }).then((r) => r.json());
  assert.strictEqual(ownView.access, 'owner');
  assert.match(ownView.shareToken, /^[a-f0-9]{32}$/);

  const sharedRes = await fetch(`${base}/api/translate/jobs/${job.jobId}?t=${ownView.shareToken}`);
  assert.strictEqual(sharedRes.status, 200);
  const shared = await sharedRes.json();
  assert.strictEqual(shared.access, 'share');
  assert.strictEqual(shared.readOnly, true);
  assert.strictEqual(shared.shareToken, undefined);
  assert.ok(shared.entries.length > 0, 'entries visible to shared viewer');

  // Write attempts from the shared viewer are rejected.
  const entry = shared.entries[0];
  const edit = await fetch(`${base}/api/translate/entries/${entry.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ translatedText: 'HIJACK', locale: entry.locale }),
  });
  assert.strictEqual(edit.status, 403, 'share token must not grant edit rights');

  const run = await fetch(`${base}/api/translate/jobs/${job.jobId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.strictEqual(run.status, 403, 'share token must not trigger translation');
});

test('default UI language is Chinese', async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /开始免费检测/);
});
