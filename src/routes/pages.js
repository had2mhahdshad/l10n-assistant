'use strict';
// Server-rendered pages (template literals, no view engine).
// All UI copy comes from lib/i18n.js — Chinese is the default, English via ?lang=en.

const express = require('express');
const { LANG_NAMES } = require('../lib/extractor');
const { pickLang, translator, clientDict, normLang } = require('../lib/i18n');
const { getTranslationConfig, getQuotaConfig } = require('../lib/settings');

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

function layout({ title, active = '', body, script = '', lang = 'zh', path = '/', T }) {
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
<meta name="theme-color" content="#ffffff" />
<meta name="description" content="${esc(T('landing.sub'))}" />
<title>${esc(title)} · L10N ASSISTANT</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%232563eb'/%3E%3Ctext x='16' y='21' font-family='sans-serif' font-weight='700' font-size='11' text-anchor='middle' fill='white'%3ELN%3C/text%3E%3C/svg%3E" />
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
  const dims = ['accuracy', 'naturalness', 'terminology', 'placeholders', 'uiLength'];
  const previewDims = dims.map((k) => `
        <div class="preview-dim-row"><span>${esc(T('dim.' + k))}</span>
          <div class="track"><i style="width:62%"></i></div><b>—</b></div>`).join('');
  res.send(layout({
    lang, T, path,
    title: T('landing.title'),
    script: '/js/landing.js',
    body: `
<section class="hero">
  <div class="container">
    <div class="hero-grid">
      <div class="hero-copy">
        <div class="index-tag">${esc(T('landing.eyebrow'))}</div>
        <h1>${esc(T('landing.h1a'))}<br /><span class="thin">${esc(T('landing.h1b'))}</span></h1>
        <p class="sub">${esc(T('landing.sub'))}</p>
        <form class="url-form" id="heroUrlForm" autocomplete="off">
          <input type="url" id="heroUrl" placeholder="${esc(T('landing.urlPlaceholder'))}" aria-label="${esc(T('landing.urlPlaceholder'))}" />
          <button class="btn primary btn-lg" type="submit">${esc(T('landing.urlSubmit'))} →</button>
        </form>
        <div class="small subtle mt-2">${esc(T('landing.urlHint'))}</div>
        <div class="cta-row">
          <a class="btn" href="#modes">${esc(T('landing.cta1'))}</a>
          <a class="btn ghost" href="/translate">${esc(T('landing.cta2'))} →</a>
        </div>
        <div class="hero-ledger">
          <span>${esc(T('landing.ledger1'))}</span>
          <span>${esc(T('landing.ledger2'))}</span>
          <span>${esc(T('landing.ledger3'))}</span>
          <span>${esc(T('landing.ledger4'))}</span>
        </div>
      </div>

      <!-- Product UI preview: structure only, no fabricated scores/cases -->
      <div class="hero-preview" aria-label="${esc(T('landing.previewCaption'))}">
        <div class="preview-bar"><i></i><i></i><i></i><span class="preview-url">app.l10n.dev /report</span></div>
        <div class="preview-body">
          <div class="preview-head">
            <div>
              <div class="preview-title">${esc(T('landing.previewTitle'))}</div>
              <div class="small muted mt-1">en → ja · ${esc(T('rep.auditSource'))}</div>
            </div>
            <span class="badge blue">${esc(T('landing.previewTag'))}</span>
          </div>
          <div class="preview-ring">
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
              <circle class="ring-track" cx="36" cy="36" r="30" />
            </svg>
            <div>
              <div class="ring-num">${esc(T('landing.previewNoScore'))}</div>
              <div class="small muted">/ 100</div>
            </div>
          </div>
          <div class="preview-dim">${previewDims}</div>
          <div class="preview-issues">
            <div class="cell-label">${esc(T('landing.previewIssues'))}</div>
            <div class="preview-issue-line"><span class="sev high"><i class="sev-dot"></i>${esc(T('sev.high'))}</span>${esc(T('type.missing_translation'))}</div>
            <div class="preview-issue-line"><span class="sev medium"><i class="sev-dot"></i>${esc(T('sev.medium'))}</span>${esc(T('type.placeholder'))}</div>
          </div>
        </div>
        <div class="preview-caption">${esc(T('landing.previewCaption'))}</div>
      </div>
    </div>
  </div>
</section>

<div class="container" id="modes">
  <div class="section-head" style="margin-top:72px">
    <span class="no">01</span><h2>${esc(T('landing.modeTitle'))}</h2><span class="rule"></span>
  </div>
  <p class="muted mb-3" style="max-width:680px">${esc(T('landing.modeSub'))}</p>
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
      <a class="btn primary" href="/checker">${esc(T('landing.aCta'))} →</a>
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
      <a class="btn" href="/translate">${esc(T('landing.bCta'))} →</a>
    </div>
  </div>
  <p class="entry-note">${esc(T('landing.entryNote'))}</p>

  <section class="section">
    <div class="section-head"><span class="no">02</span><h2>${esc(T('landing.capTitle'))}</h2><span class="rule"></span></div>
    <div class="feature-grid">
      <div class="feature paper"><div class="f-no">01</div><h3>${esc(T('landing.cap1T'))}</h3><p>${esc(T('landing.cap1D'))}</p></div>
      <div class="feature paper"><div class="f-no">02</div><h3>${esc(T('landing.cap2T'))}</h3><p>${esc(T('landing.cap2D'))}</p></div>
      <div class="feature paper"><div class="f-no">03</div><h3>${esc(T('landing.cap3T'))}</h3><p>${esc(T('landing.cap3D'))}</p><p style="margin-top:10px">${esc(T('landing.cap3D2'))}</p><p style="margin-top:10px">${esc(T('landing.cap3D3'))}</p></div>
      <div class="feature paper"><div class="f-no">04</div><h3>${esc(T('landing.cap4T'))}</h3><p>${esc(T('landing.cap4D'))}</p></div>
      <div class="feature paper"><div class="f-no">05</div><h3>${esc(T('landing.cap5T'))}</h3><p>${esc(T('landing.cap5D'))}</p></div>
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
  <div class="section-head"><span class="no">01</span><h2>${esc(T('checker.head'))}</h2><span class="rule"></span><span class="badge green">${esc(T('landing.free'))}</span></div>

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
      <div class="notice info tiny mt-2">${esc(T('checker.completeHint'))}</div>
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
  const tCfg = getTranslationConfig();
  const qCfg = getQuotaConfig();
  const targets = tCfg.enabledTargetLocales;
  const pageLimit = Math.max(1, Math.min(qCfg.freeUrlPagesPerJob, tCfg.mvpUrlPageLimit));
  const limits = ['url.notFullSite', 'url.notSourceCode', 'url.frameworkCompat', 'url.pageLimit']
    .map((k) => `<li>${esc(T(k))}</li>`).join('');
  res.send(layout({
    lang, T, path,
    title: T('tr.title'),
    active: 'translate',
    script: '/js/translate-new.js',
    body: `
<div class="container" style="padding:48px 0">
  <div class="section-head"><span class="no">01</span><h2>${esc(T('tr.head'))}</h2><span class="rule"></span><span class="badge blue">${esc(T('tr.badge'))}</span></div>
  <div class="notice info"><b>${esc(T('tr.noticeLabel'))}</b> ${esc(T('tr.notice'))}</div>

  <div class="pill-tabs" role="tablist">
    <button id="tabJson" class="active" type="button">${esc(T('tr.tabJson'))}</button>
    <button id="tabUrl" type="button">${esc(T('url.tab'))}</button>
  </div>

  <div id="paneJson">
    <div class="form-panel paper">
      <div class="field">
        <label for="jsonInput"><b>${esc(T('tr.jsonLabel'))}</b></label>
        <textarea id="jsonInput" style="min-height:160px" placeholder='{"nav":{"home":"Home"},"cta":{"start":"Get started"}}' spellcheck="false"></textarea>
        <div class="hint"><input type="file" id="jsonFile" accept=".json,application/json" /> <span id="fileName" class="subtle"></span></div>
      </div>
    </div>
  </div>

  <div id="paneUrl" class="hidden">
    <div class="form-panel paper">
      <div class="notice warn">
        <b>${esc(T('url.partialBadge'))}</b>
        <ul class="nt-list">${limits}</ul>
      </div>
      <div class="field">
        <label for="websiteUrl"><b>${esc(T('url.inputLabel'))}</b></label>
        <input type="url" id="websiteUrl" placeholder="${esc(T('url.inputPh'))}" />
      </div>
      <div class="small subtle">${esc(T('url.pageLimitHint').replace('{n}', pageLimit))}</div>
    </div>
  </div>

  <div class="form-panel paper mt-3">
    <div class="field-row cols-2">
      <div class="field">
        <label for="tSourceLang"><b>${esc(T('tr.srcLang'))}</b></label>
        <select id="tSourceLang">${langOptions(tCfg.sourceLocales, 'en')}</select>
      </div>
      <div class="field">
        <label><b>${esc(T('tr.tgtLangs'))}</b></label>
        <div style="display:flex;gap:16px;padding-top:10px;flex-wrap:wrap">
          ${targets.map((l) => `<label class="checkbox-line"><input type="checkbox" class="t-target" value="${esc(l)}" ${l === (targets.includes('ja') ? 'ja' : (targets.find((x) => x !== 'en') || targets[0])) ? 'checked' : ''} /> ${esc(T('lang.' + l))}</label>`).join('')}
        </div>
      </div>
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
    <button class="btn primary" id="createJob" type="button">${esc(T('tr.create'))}</button>
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
  <div class="section-head"><span class="no">01</span><h2>${esc(T('admin.head'))}</h2><span class="rule"></span></div>
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

// ── Admin settings ──────────────────────────────────────────────────────
r.get('/admin/settings', (req, res) => {
  const { lang, T, path } = ctx(req, res);
  res.send(layout({
    lang, T, path,
    title: T('cfg.title'),
    script: '/js/admin-settings.js',
    body: `
<div class="container" style="padding:48px 0">
  <div class="section-head"><span class="no">01</span><h2>${esc(T('cfg.head'))}</h2><span class="rule"></span></div>
  <div class="notice warn"><b>${esc(T('cfg.restricted'))}</b></div>
  <div class="form-panel paper" style="max-width:480px">
    <div class="field">
      <label for="cfgToken">${esc(T('cfg.token'))}</label>
      <input type="password" id="cfgToken" placeholder="••••••••" autocomplete="off" />
    </div>
    <button class="btn primary" id="cfgLoad" type="button">${esc(T('cfg.load'))}</button>
  </div>
  <div id="cfgStatus" class="mt-2"></div>
  <div id="cfgRoot" class="mt-3"></div>
</div>`,
  }));
});

module.exports = r;
