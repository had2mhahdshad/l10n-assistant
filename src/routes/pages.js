'use strict';
// Server-rendered pages (template literals, no view engine).
// All UI copy comes from lib/i18n.js — English is the default, Chinese via ?lang=zh.

const express = require('express');
const { LANG_NAMES } = require('../lib/extractor');
const { pickLang, translator, clientDict, normLang } = require('../lib/i18n');

const r = express.Router();

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Swap the lang param on the current URL so the language toggle keeps context. */
function langHref(url, lang) {
  const [path, qs = ''] = url.split('?');
  const params = new URLSearchParams(qs);
  params.set('lang', lang);
  return `${path}?${params.toString()}`;
}

function layout({ title, active = '', body, script = '', lang = 'en', path = '/', T }) {
  const other = lang === 'en' ? 'zh' : 'en';
  const nav = [
    ['/', T('nav.home'), ''],
    ['/checker', T('nav.checker'), 'checker'],
    ['/translate', T('nav.translate'), 'translate'],
    ['/professional', T('nav.professional'), 'professional'],
  ];
  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#efede4" />
<meta name="description" content="${esc(T('landing.sub'))}" />
<title>${esc(title)} · L10N ASSISTANT</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23efede4'/%3E%3Crect x='3' y='3' width='26' height='26' fill='none' stroke='%232d2e2a'/%3E%3Ctext x='16' y='21' font-family='monospace' font-size='12' text-anchor='middle' fill='%232d2e2a'%3ELN%3C/text%3E%3C/svg%3E" />
<link rel="stylesheet" href="/css/theme.css" />
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<div class="shell">
  <header class="topbar paper">
    <a class="brand" href="/" aria-label="L10N ASSISTANT home">
      <span class="brand-mark" aria-hidden="true"><b>L10N</b><i>01</i></span>
      <span class="brand-copy">
        <small class="kicker">${esc(T('brand.kicker'))}</small>
        <strong>L10N ASSISTANT</strong>
        <small>${esc(T('brand.sub'))}</small>
      </span>
    </a>
    <nav class="topnav">
      ${nav.map(([href, label, key]) => `<a href="${href}" class="${active === key ? 'active' : ''}">${esc(label)}</a>`).join('')}
    </nav>
    <div class="top-actions">
      <a class="btn sm" href="/checker">${esc(T('top.freeCheck'))}</a>
      <a class="btn sm primary" href="/translate">${esc(T('top.translateJson'))}</a>
      <a class="btn sm ghost lang-switch" href="${esc(langHref(path, other))}" hreflang="${other}" title="${esc(T('lang.label'))}">${esc(T('lang.switch'))}</a>
    </div>
  </header>
  <main>${body}</main>
  <footer class="footer paper">
    <div class="container cols">
      <span>${esc(T('foot.1'))}</span>
      <span>${esc(T('foot.2'))}</span>
      <span>${esc(T('foot.3'))}</span>
    </div>
  </footer>
</div>
<script>window.__LANG__=${JSON.stringify(lang)};window.__D__=${JSON.stringify(clientDict(lang))};window.T=function(k){return (window.__D__&&window.__D__[k]!=null)?window.__D__[k]:k};</script>
${script ? `<script src="${script}"></script>` : ''}
</body>
</html>`;
}

const langOptions = (langs, selected) =>
  langs.map((l) => `<option value="${l}" ${l === selected ? 'selected' : ''}>${LANG_NAMES[l] || l}</option>`).join('');

/** Shared ctx for every page: language + bound translator + the toggle target. */
function ctx(req, res) {
  const lang = pickLang(req);
  // Remember an explicit choice so internal links keep the language.
  if (res && normLang(req.query && req.query.lang)) {
    res.setHeader('set-cookie', `l10n_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }
  return { lang, T: translator(lang), path: req.originalUrl || req.path };
}

// ── Landing ──────────────────────────────────────────────────────────────
r.get('/', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  res.send(layout({
    lang, T, path,
    title: T('landing.title'),
    body: `
<section class="hero paper">
  <div class="container" style="position:relative">
    <div class="index-tag">${esc(T('landing.fileNo'))}</div>
    <h1>${esc(T('landing.h1a'))}<br /><span class="thin">${esc(T('landing.h1b'))}</span></h1>
    <p class="sub">${esc(T('landing.sub'))}</p>
    <div class="cta-row">
      <a class="btn primary" href="/checker">${esc(T('landing.cta1'))}</a>
      <a class="btn" href="/translate">${esc(T('landing.cta2'))}</a>
    </div>
    <div class="hero-ledger">
      ${esc(T('landing.ledger1'))}<br />${esc(T('landing.ledger2'))}<br />${esc(T('landing.ledger3'))}<br />${esc(T('landing.ledger4'))}
    </div>
  </div>
</section>

<div class="container">
  <div class="entries">
    <div class="entry-card paper">
      <span class="card-no">${esc(T('landing.entryA'))}</span>
      <span class="badge green">${esc(T('landing.free'))}</span>
      <h2>${esc(T('landing.aTitle'))}</h2>
      <div class="card-sub">${esc(T('landing.aSub'))}</div>
      <hr />
      <ul>
        <li>${esc(T('landing.a1'))}</li>
        <li>${esc(T('landing.a2'))}</li>
        <li>${esc(T('landing.a3'))}</li>
        <li>${esc(T('landing.a4'))}</li>
        <li>${esc(T('landing.a5'))}</li>
      </ul>
      <a class="btn primary" href="/checker">${esc(T('landing.aCta'))}</a>
    </div>
    <div class="entry-card paper">
      <span class="card-no">${esc(T('landing.entryB'))}</span>
      <span class="badge blue">${esc(T('landing.paid'))}</span>
      <h2>${esc(T('landing.bTitle'))}</h2>
      <div class="card-sub">${esc(T('landing.bSub'))}</div>
      <hr />
      <ul>
        <li>${esc(T('landing.b1'))}</li>
        <li>${esc(T('landing.b2'))}</li>
        <li>${esc(T('landing.b3'))}</li>
        <li>${esc(T('landing.b4'))}</li>
        <li>${esc(T('landing.b5'))}</li>
      </ul>
      <a class="btn sky" href="/translate">${esc(T('landing.bCta'))}</a>
    </div>
  </div>
  <p class="entry-note">${esc(T('landing.entryNote'))}</p>

  <section class="section">
    <div class="section-head"><span class="no">01</span><h2>${esc(T('landing.capTitle'))}</h2><span class="rule"></span></div>
    <div class="feature-grid">
      <div class="feature paper"><div class="f-no">CAP / 01</div><h3>${esc(T('landing.cap1T'))}</h3><p>${esc(T('landing.cap1D'))}</p></div>
      <div class="feature paper"><div class="f-no">CAP / 02</div><h3>${esc(T('landing.cap2T'))}</h3><p>${esc(T('landing.cap2D'))}</p></div>
      <div class="feature paper"><div class="f-no">CAP / 03</div><h3>${esc(T('landing.cap3T'))}</h3><p>${esc(T('landing.cap3D'))}</p><p style="margin-top:10px">${esc(T('landing.cap3D2'))}</p><p style="margin-top:10px">${esc(T('landing.cap3D3'))}</p></div>
      <div class="feature paper"><div class="f-no">CAP / 04</div><h3>${esc(T('landing.cap4T'))}</h3><p>${esc(T('landing.cap4D'))}</p></div>
      <div class="feature paper"><div class="f-no">CAP / 05</div><h3>${esc(T('landing.cap5T'))}</h3><p>${esc(T('landing.cap5D'))}</p></div>
    </div>
  </section>
</div>`,
  }));
});

// ── Checker form ─────────────────────────────────────────────────────────
r.get('/checker', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  res.send(layout({
    lang, T, path,
    title: T('checker.title'),
    active: 'checker',
    script: '/js/checker.js',
    body: `
<div class="container" style="padding:48px 0">
  <div class="section-head"><span class="no">CHK</span><h2>${esc(T('checker.head'))}</h2><span class="rule"></span><span class="badge green">${esc(T('landing.free'))}</span></div>

  <div class="pill-tabs" role="tablist">
    <button id="tabWebsite" class="active" type="button">${esc(T('checker.tabWebsite'))}</button>
    <button id="tabJson" type="button">${esc(T('checker.tabJson'))}</button>
  </div>

  <div id="paneWebsite">
    <div class="form-panel paper">
      <div class="notice warn">
        <b>${esc(T('checker.scopeLabel'))}</b> ${esc(T('checker.scope'))}
      </div>
      <div class="field">
        <label for="websiteUrl"><b>${esc(T('checker.srcUrl'))}</b></label>
        <input type="url" id="websiteUrl" placeholder="${esc(T('checker.srcUrlPh'))}" required />
      </div>
      <div class="field">
        <label for="targetUrl">${esc(T('checker.tgtUrl'))}</label>
        <input type="url" id="targetUrl" placeholder="${esc(T('checker.tgtUrlPh'))}" />
        <div class="hint">${esc(T('checker.tgtHint'))}</div>
      </div>
      <div class="field-row cols-2">
        <div class="field">
          <label for="sourceLang"><b>${esc(T('checker.srcLang'))}</b></label>
          <select id="sourceLang">${langOptions(['en', 'zh', 'ja', 'de', 'fr'], 'en')}</select>
        </div>
        <div class="field">
          <label for="targetLang"><b>${esc(T('checker.tgtLang'))}</b></label>
          <select id="targetLang">${langOptions(['ja', 'de', 'fr', 'en', 'zh'], 'ja')}</select>
        </div>
      </div>
      <button class="btn primary" id="runWebsite" type="button">${esc(T('checker.runWebsite'))}</button>
      <span class="tiny subtle" id="quotaHint" style="margin-left:12px">${esc(T('checker.quotaHint'))}</span>
    </div>
  </div>

  <div id="paneJson" class="hidden">
    <div class="form-panel paper">
      <div class="notice info">
        <b>${esc(T('checker.auditNoticeLabel'))}</b> ${esc(T('checker.auditNotice'))}
      </div>
      <div class="field">
        <label for="jsonSource"><b>${esc(T('checker.srcJson'))}</b></label>
        <textarea id="jsonSource" placeholder='{"nav": {"home": "Home", "pricing": "Pricing"}}' spellcheck="false"></textarea>
      </div>
      <div class="field">
        <label for="jsonTarget">${esc(T('checker.tgtJson'))}</label>
        <textarea id="jsonTarget" placeholder='{"nav": {"home": "ホーム", "pricing": "料金"}}' spellcheck="false"></textarea>
      </div>
      <div class="field-row cols-2">
        <div class="field">
          <label for="jsonSourceLang"><b>${esc(T('checker.srcLang'))}</b></label>
          <select id="jsonSourceLang">${langOptions(['en', 'zh', 'ja', 'de', 'fr'], 'en')}</select>
        </div>
        <div class="field">
          <label for="jsonTargetLang"><b>${esc(T('checker.tgtLang'))}</b></label>
          <select id="jsonTargetLang">${langOptions(['ja', 'de', 'fr', 'en', 'zh'], 'ja')}</select>
        </div>
      </div>
      <button class="btn primary" id="runJson" type="button">${esc(T('checker.runAudit'))}</button>
    </div>
  </div>

  <div id="checkerStatus" class="mt-3"></div>
</div>`,
  }));
});

// ── Audit report ─────────────────────────────────────────────────────────
r.get('/report/:id', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  res.send(layout({
    lang, T, path,
    title: T('rep.head'),
    active: 'checker',
    script: '/js/report.js',
    body: `
<div class="container" style="padding:48px 0" data-audit-id="${esc(req.params.id)}">
  <div id="reportRoot"><div class="notice info"><span class="spinner"></span> ${esc(T('tr.reportLoading'))}</div></div>
</div>`,
  }));
});

// ── Translation: new job ─────────────────────────────────────────────────
r.get('/translate', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  res.send(layout({
    lang, T, path,
    title: T('tr.title'),
    active: 'translate',
    script: '/js/translate-new.js',
    body: `
<div class="container" style="padding:48px 0">
  <div class="section-head"><span class="no">TRN</span><h2>${esc(T('tr.head'))}</h2><span class="rule"></span><span class="badge blue">${esc(T('tr.badge'))}</span></div>
  <div class="notice info">
    <b>${esc(T('tr.noticeLabel'))}</b> ${esc(T('tr.notice'))}
  </div>
  <div class="form-panel paper">
    <div class="field">
      <label for="jsonInput"><b>${esc(T('tr.jsonLabel'))}</b></label>
      <textarea id="jsonInput" style="min-height:180px" placeholder='{"nav":{"home":"Home"},"cta":{"start":"Get started"}}' spellcheck="false"></textarea>
      <div class="hint"><input type="file" id="jsonFile" accept=".json,application/json" /> <span id="fileName" class="subtle"></span></div>
    </div>
    <div class="field-row cols-2">
      <div class="field">
        <label for="projectName">${esc(T('tr.projectName'))}</label>
        <input type="text" id="projectName" placeholder="${esc(T('tr.projectPh'))}" />
      </div>
      <div class="field">
        <label for="filename">${esc(T('tr.fileName'))}</label>
        <input type="text" id="filename" value="common.json" />
      </div>
    </div>
    <div class="field-row cols-2">
      <div class="field">
        <label for="tSourceLang"><b>${esc(T('tr.srcLang'))}</b></label>
        <select id="tSourceLang">${langOptions(['en', 'zh', 'zh-CN'], 'en')}</select>
      </div>
      <div class="field">
        <label><b>${esc(T('tr.tgtLangs'))}</b></label>
        <div style="display:flex;gap:18px;padding-top:10px">
          <label class="checkbox-line"><input type="checkbox" class="t-target" value="ja" checked /> ${esc(T('lang.ja'))}</label>
          <label class="checkbox-line"><input type="checkbox" class="t-target" value="de" /> ${esc(T('lang.de'))}</label>
          <label class="checkbox-line"><input type="checkbox" class="t-target" value="fr" /> ${esc(T('lang.fr'))}</label>
        </div>
      </div>
    </div>
    <div class="field-row cols-2">
      <div class="field">
        <label for="productType">${esc(T('tr.productType'))}</label>
        <input type="text" id="productType" placeholder="${esc(T('tr.productPh'))}" />
      </div>
      <div class="field">
        <label for="style">${esc(T('tr.style'))}</label>
        <select id="style">
          <option value="product-neutral">${esc(T('tr.styleNeutral'))}</option>
          <option value="formal">${esc(T('tr.styleFormal'))}</option>
          <option value="friendly">${esc(T('tr.styleFriendly'))}</option>
          <option value="concise">${esc(T('tr.styleConcise'))}</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label for="context">${esc(T('tr.context'))}</label>
      <textarea id="context" style="min-height:70px" placeholder="${esc(T('tr.contextPh'))}"></textarea>
    </div>
    <div class="field">
      <label for="brandTerms">${esc(T('tr.brand'))}</label>
      <input type="text" id="brandTerms" placeholder="Acme, AcmeCloud, FlowBoard" />
    </div>
    <div class="field">
      <label for="ignoreKeys">${esc(T('tr.ignore'))}</label>
      <input type="text" id="ignoreKeys" placeholder="^config\\., ^meta\\." />
    </div>
    <button class="btn sky" id="createJob" type="button">${esc(T('tr.create'))}</button>
    <span id="createStatus" class="tiny" style="margin-left:12px"></span>
  </div>
</div>`,
  }));
});

// ── Translation: workspace ───────────────────────────────────────────────
r.get('/translate/jobs/:id', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  res.send(layout({
    lang, T, path,
    title: T('tr.title'),
    active: 'translate',
    script: '/js/workspace.js',
    body: `
<div class="container" style="padding:32px 0 48px" data-job-id="${esc(req.params.id)}">
  <div id="wsRoot"><div class="notice info"><span class="spinner"></span> ${esc(T('tr.loading'))}</div></div>
</div>`,
  }));
});

// ── Professional service (lead capture) ──────────────────────────────────
r.get('/professional', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  const auditId = req.query.audit || '';
  res.send(layout({
    lang, T, path,
    title: T('pro.title'),
    active: 'professional',
    script: '/js/professional.js',
    body: `
<div class="container" style="padding:48px 0" data-audit-id="${esc(auditId)}">
  <div class="section-head"><span class="no">PRO</span><h2>${esc(T('pro.head'))}</h2><span class="rule"></span><span class="badge yellow">${esc(T('pro.badge'))}</span></div>
  <div class="grid-2">
    <div>
      <p class="muted">${esc(T('pro.intro'))}</p>
      <div class="feature-grid mt-3" style="grid-template-columns:1fr">
        <div class="feature paper"><div class="f-no">SVC / 01</div><h3>${esc(T('pro.svc1T'))}</h3><p>${esc(T('pro.svc1D'))}</p></div>
        <div class="feature paper"><div class="f-no">SVC / 02</div><h3>${esc(T('pro.svc2T'))}</h3><p>${esc(T('pro.svc2D'))}</p></div>
        <div class="feature paper"><div class="f-no">SVC / 03</div><h3>${esc(T('pro.svc3T'))}</h3><p>${esc(T('pro.svc3D'))}</p></div>
      </div>
    </div>
    <div class="form-panel paper">
      <div id="auditLinkNote"></div>
      <div class="field">
        <label for="leadEmail"><b>${esc(T('pro.email'))}</b></label>
        <input type="email" id="leadEmail" placeholder="you@company.com" />
      </div>
      <div class="field">
        <label for="leadProduct">${esc(T('pro.product'))}</label>
        <input type="text" id="leadProduct" placeholder="Acme Inc. / FlowBoard" />
      </div>
      <div class="field">
        <label><b>${esc(T('pro.tgtLangs'))}</b></label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;padding-top:8px">
          <label class="checkbox-line"><input type="checkbox" class="lead-lang" value="ja" /> ${esc(T('lang.ja'))}</label>
          <label class="checkbox-line"><input type="checkbox" class="lead-lang" value="de" /> ${esc(T('lang.de'))}</label>
          <label class="checkbox-line"><input type="checkbox" class="lead-lang" value="fr" /> ${esc(T('lang.fr'))}</label>
          <label class="checkbox-line"><input type="checkbox" class="lead-lang" value="zh" /> ${esc(T('lang.zh'))}</label>
          <label class="checkbox-line"><input type="checkbox" class="lead-lang" value="en" /> ${esc(T('lang.en'))}</label>
        </div>
      </div>
      <div class="field-row cols-2">
        <div class="field">
          <label for="leadType"><b>${esc(T('pro.serviceType'))}</b></label>
          <select id="leadType">
            <option value="Review Existing Translations">${esc(T('pro.typeReview'))}</option>
            <option value="Fix Translation Errors">${esc(T('pro.typeFix'))}</option>
            <option value="Full Professional Localization">${esc(T('pro.typeFull'))}</option>
            <option value="SaaS UI Copywriting">${esc(T('pro.typeCopy'))}</option>
            <option value="Other">${esc(T('pro.typeOther'))}</option>
          </select>
        </div>
        <div class="field">
          <label for="leadWords">${esc(T('pro.words'))}</label>
          <input type="number" id="leadWords" min="0" placeholder="3000" />
        </div>
      </div>
      <div class="field">
        <label for="leadDesc">${esc(T('pro.notes'))}</label>
        <textarea id="leadDesc" style="min-height:80px" placeholder="${esc(T('pro.notesPh'))}"></textarea>
      </div>
      <div class="field">
        <label class="checkbox-line"><input type="checkbox" id="leadReview" checked /> ${esc(T('pro.needReview'))}</label>
      </div>
      <button class="btn primary" id="submitLead" type="button">${esc(T('pro.submit'))}</button>
      <div id="leadStatus" class="mt-2"></div>
    </div>
  </div>
</div>`,
  }));
});

// ── Admin leads ──────────────────────────────────────────────────────────
r.get('/admin/leads', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  res.send(layout({
    lang, T, path,
    title: T('admin.title'),
    script: '/js/admin.js',
    body: `
<div class="container" style="padding:48px 0">
  <div class="section-head"><span class="no">ADM</span><h2>${esc(T('admin.head'))}</h2><span class="rule"></span></div>
  <div class="notice warn"><b>${esc(T('admin.restricted'))}</b></div>
  <div class="form-panel paper" style="max-width:420px">
    <div class="field">
      <label for="adminToken">${esc(T('admin.token'))}</label>
      <input type="text" id="adminToken" placeholder="••••••••" />
    </div>
    <button class="btn primary" id="loadLeads" type="button">${esc(T('admin.load'))}</button>
  </div>
  <div id="leadsRoot" class="mt-3"></div>
</div>`,
  }));
});

module.exports = r;
