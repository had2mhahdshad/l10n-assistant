/* Audit report page — score, distributions, real issue examples, paywall note, professional CTA. */
(function () {
  'use strict';
  var root = document.getElementById('reportRoot');
  var id = document.querySelector('[data-audit-id]').getAttribute('data-audit-id');
  var shareToken = new URLSearchParams(location.search).get('t') || '';
  var T = window.T || function (k) { return k; };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /**
   * IMPORTANT: every string passed into these maps is a DOM id, so translation
   * must never affect behaviour — only the visible label.
   */
  var TYPE_KEYS = {
    missing_translation: 'type.missing_translation',
    semantic_error: 'type.semantic_error',
    grammar: 'type.grammar',
    unnatural: 'type.unnatural',
    terminology: 'type.terminology',
    placeholder: 'type.placeholder',
    html_integrity: 'type.html_integrity',
    url_change: 'type.url_change',
    ui_length: 'type.ui_length',
    cultural: 'type.cultural',
    language_mismatch: 'type.language_mismatch'
  };
  function sevLabel(s) { var k = 'sev.' + s; var v = T(k); return v === k ? s : v; }
  function typeLabel(t) {
    var k = TYPE_KEYS[t];
    return k ? T(k) : t;
  }
  var DIM_ORDER = ['accuracy', 'naturalness', 'terminology', 'placeholders', 'uiLength'];

  fetch('/api/audit/' + encodeURIComponent(id) + (shareToken ? '?t=' + encodeURIComponent(shareToken) : ''))
    .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
    .then(function (r) {
      if (!r.ok) {
        root.innerHTML = '<div class="notice error"><b>' + esc(r.d.error || 'Report unavailable.') + '</b>' +
          (r.d.hint ? '<div class="tiny mt-1">' + esc(r.d.hint) + '</div>' : '') +
          '</div><p class="mt-3"><a class="btn" href="/checker">' + esc(T('rep.back')) + '</a></p>';
        return;
      }
      render(r.d);
    })
    .catch(function (e) { root.innerHTML = '<div class="notice error">Failed to load report: ' + esc(e.message) + '</div>'; });

  var sharedNote = shareToken
    ? '<div class="notice info tiny mb-2"><b>' + esc(T('rep.shared')) + '</b></div>'
    : '';

  function band(score) {
    if (score == null) return ['NE', T('rep.notEvaluated')];
    if (score >= 85) return ['green', T('rep.good')];
    if (score >= 70) return ['yellow', T('rep.needsAttention')];
    if (score >= 50) return ['pink', T('rep.atRisk')];
    return ['red', T('rep.critical')];
  }

  // Highlight dynamic variables / URLs inside a text segment so the exact
  // problem spot is visible. Escaping happens first — no markup injection.
  function highlight(s) {
    var out = esc(s == null ? '—' : s);
    out = out.replace(/(\{\{[^{}]+\}\}|\{[^{}]+\}|\$\{[^{}]+\}|%[sd]|&lt;\/?[a-zA-Z][^&]*?&gt;)/g,
      '<mark class="var">$1</mark>');
    out = out.replace(/(https?:\/\/[^\s<"']+)/g, '<mark>$1</mark>');
    return out;
  }

  function scoreRing(score, band) {
    if (score == null) {
      return '<div class="score-ring"><svg viewBox="0 0 176 176"><circle class="ring-track" cx="88" cy="88" r="74" /></svg>' +
        '<div class="ring-center"><div class="ring-num" style="font-size:28px">N/E</div>' +
        '<div class="ring-of">' + esc(T('rep.insufficient')) + '</div></div></div>';
    }
    var risk = score < 60 ? 'risk-high' : (score < 80 ? 'risk-medium' : 'risk-good');
    var circumference = 2 * Math.PI * 74;
    var offset = circumference * (1 - score / 100);
    return '<div class="score-ring">' +
      '<svg viewBox="0 0 176 176" aria-hidden="true">' +
      '<circle class="ring-track" cx="88" cy="88" r="74" />' +
      '<circle class="ring-value ' + risk + '" cx="88" cy="88" r="74" ' +
      'stroke-dasharray="' + circumference.toFixed(1) + '" stroke-dashoffset="' + circumference.toFixed(1) + '" ' +
      'data-target-offset="' + offset.toFixed(1) + '" />' +
      '</svg><div class="ring-center"><div class="ring-num">' + score + '</div>' +
      '<div class="ring-of">/ 100</div><div class="ring-band">' + esc(band) + '</div></div></div>';
  }

  function animateRings() {
    var circles = root.querySelectorAll('.ring-value[data-target-offset]');
    // Two frames so the CSS transition actually runs from the full offset.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        circles.forEach(function (c) { c.setAttribute('stroke-dashoffset', c.getAttribute('data-target-offset')); });
      });
    });
  }

  function render(d) {
    if (d.status === 'failed') {
      root.innerHTML = '<div class="notice error"><b>' + esc(T('rep.checkFailed')) + '</b> ' + esc(d.error) + '</div>' +
        '<p class="mt-3"><a class="btn" href="/checker">' + esc(T('rep.back')) + '</a></p>';
      return;
    }
    var b = band(d.score);
    var sev = d.severityDist || {};
    var typeDist = d.typeDist || {};
    var typeRows = Object.keys(typeDist).map(function (t) {
      return '<tr><td>' + esc(typeLabel(t)) + '</td><td class="num">' + typeDist[t] + '</td></tr>';
    }).join('');

    var dims = DIM_ORDER.map(function (k) {
      var dim = (d.dimensions || {})[k];
      if (!dim) return '';
      var name = T('dim.' + k);
      if (!dim.evaluated || dim.score == null) {
        return '<div class="dim-row"><span class="dim-name">' + esc(name) + ' <span class="dim-weight">' + Math.round(dim.weight * 100) + '%</span></span>' +
          '<span class="dim-score ne">' + esc(T('rep.notEvaluatedShort')) + '</span><div class="dim-bar"></div></div>';
      }
      return '<div class="dim-row"><span class="dim-name">' + esc(name) + ' <span class="dim-weight">' + Math.round(dim.weight * 100) + '%</span></span>' +
        '<span class="dim-score">' + dim.score + '</span>' +
        '<div class="dim-bar"><i style="width:' + dim.score + '%"></i></div></div>';
    }).join('');

    var examples = (d.freeExamples || []).map(function (i, idx) {
      return '<div class="issue sev-' + esc(i.severity) + '">' +
        '<div class="issue-head"><span class="badge ink">EX / ' + (idx + 1) + '</span>' +
        '<span class="itype">' + esc(typeLabel(i.issueType)) + '</span>' +
        '<span class="sev ' + esc(i.severity) + '"><i class="sev-dot"></i>' + esc(sevLabel(i.severity)) + '</span>' +
        (i.pageUrl
          ? '<a class="btn sm view-page" href="' + esc(i.pageUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(T('rep.viewPage')) + '</a>'
          : '') +
        (i.context ? '<span class="ipage mono">' + esc(i.context) + '</span>' : '') + '</div>' +
        '<div class="issue-body">' +
        (i.sourceText ? '<div class="issue-cell"><div class="cell-label">' + esc(T('rep.source')) + '</div><pre>' + highlight(i.sourceText) + '</pre></div>' : '') +
        '<div class="issue-cell"><div class="cell-label">' + esc(T('rep.current')) + '</div><pre>' + highlight(i.currentTranslation || '—') + '</pre></div>' +
        '</div>' +
        '<div class="issue-foot"><b>' + esc(T('rep.direction')) + ':</b> ' + esc(i.suggestion || i.reason || '—') + '</div>' +
        '<div class="pro-inline" style="margin:0;border:0;border-top:1px solid var(--line);border-radius:0">' +
        '<span>' + esc(T('rep.proInline')) + '</span>' +
        '<a class="btn sm" href="/professional?audit=' + encodeURIComponent(d.id) + '">' + esc(T('rep.proInlineBtn')) + ' →</a>' +
        '</div>' +
        '</div>';
    }).join('');

    var summaries = (d.summaries || []).slice(0, 30).map(function (s) {
      return '<tr><td>' + esc(typeLabel(s.issueType)) + '</td>' +
        '<td><span class="sev ' + esc(s.severity) + '">' + esc(sevLabel(s.severity)) + '</span></td>' +
        '<td class="mono small">' +
          (s.pageUrl
            ? '<a href="' + esc(s.pageUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(s.pageUrl) + '</a>'
            : esc(s.context || '—')) + '</td>' +
        '<td class="small muted">' + esc(s.excerpt || '') + '</td></tr>';
    }).join('');

    // Content that text translation can never reach.
    var nt = d.nonTranslatable;
    var ntHtml = '';
    if (nt === null && d.scannedPages === 0) {
      ntHtml = '<div class="notice tiny">' + esc(T('rep.transJson')) + '</div>';
    } else if (nt) {
      var ntRows = [];
      if (nt.images) ntRows.push([T('rep.transImages'), nt.images + (nt.imagesWithoutAlt ? ' · ' + nt.imagesWithoutAlt + ' ' + T('rep.transImagesNoAlt') : '')]);
      if (nt.iframes) ntRows.push([T('rep.transIframes'), nt.iframes]);
      if (nt.canvas) ntRows.push([T('rep.transCanvas'), nt.canvas]);
      if (nt.videos) ntRows.push([T('rep.transVideos'), nt.videos]);
      if (nt.svgs) ntRows.push([T('rep.transSvgs'), nt.svgs]);
      if (nt.noTranslateMarked) ntRows.push([T('rep.transNoTranslate'), nt.noTranslateMarked]);
      ntHtml = ntRows.length
        ? '<div class="notice warn tiny"><b>' + esc(T('rep.transDesc')) + '</b><ul class="nt-list">' +
          ntRows.map(function (r) { return '<li>' + esc(r[0]) + ' — <b>' + esc(String(r[1])) + '</b></li>'; }).join('') + '</ul></div>'
        : '<div class="notice tiny">' + esc(T('rep.transAll')) + '</div>';
    }

    root.innerHTML = sharedNote +
      '<div class="section-head"><span class="no">01</span><h2>' + esc(T('rep.head')) + '</h2><span class="rule"></span>' +
      '<span class="badge ' + b[0] + '">' + esc(b[1]) + '</span></div>' +

      '<div class="muted small mb-3 mono">' +
      (d.websiteUrlRaw
        ? '<a class="report-url" href="' + esc(d.websiteUrlRaw) + '" target="_blank" rel="noopener noreferrer">' + esc(d.websiteUrlRaw) + '</a>'
        : esc(d.websiteUrl)) +
      (d.targetUrl
        ? ' → <a class="report-url" href="' + esc(d.targetUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(d.targetUrl) + '</a>'
        : '') + ' · ' + esc(d.sourceLanguage) + ' → ' + esc(d.targetLanguage) + '</div>' +

      '<div class="notice warn tiny"><b>' + esc(T('rep.scopeLabel')) + '</b> ' + esc(d.coverageNote || '') + ' ' +
      (d.scannedPages > 0
        ? esc(T('rep.scanned')) + ' <b>' + d.scannedPages + '</b>' +
          (d.failedPages ? ' · ' + esc(T('rep.inaccessible')) + ' <b>' + d.failedPages + '</b>' : '')
        : esc(T('rep.auditSource')) + ' <b>' + esc(T('rep.uploadedJson')) + '</b>') +
      ' · ' + esc(T('rep.samples')) + ' <b>' + (d.sampleSize || 0) + '</b>.' +
      (d.aiDegraded ? ' ' + esc(T('rep.aiDegraded')) : '') +
      '</div>' +

      '<div class="mt-4"><div class="nt-title">' + esc(T('rep.transTitle')) + '</div>' + ntHtml + '</div>' +

      '<div class="stat-row">' +
      '<div class="stat-card"><div class="stat-num">' + (d.issueCount || 0) + '</div><div class="stat-label">' + esc(T('rep.total')) + '</div></div>' +
      '<div class="stat-card risk"><div class="stat-num">' + (sev.high || 0) + '</div><div class="stat-label">' + esc(T('rep.high')) + ' · ' + esc(T('rep.severity')) + '</div></div>' +
      '<div class="stat-card"><div class="stat-num">' + (d.sampleSize || 0) + '</div><div class="stat-label">' + esc(T('rep.samples')) + '</div></div>' +
      '</div>' +

      '<div class="score-wrap">' +
      '<div class="score-card paper"><div class="score-label">' + esc(T('rep.overall')) + '</div>' +
      scoreRing(d.score, b[1]) +
      '<div class="tiny subtle mt-2">' + esc(T('rep.assistive')) + '</div>' +
      '</div>' +
      '<div><div class="dim-list paper">' + dims + '</div>' +
      '<div class="tbl-wrap mt-2"><table class="tbl"><thead><tr><th>' + esc(T('rep.issueType')) + '</th><th class="num">' + esc(T('rep.count')) + '</th></tr></thead><tbody>' +
      typeRows + '<tr><td><b>' + esc(T('rep.total')) + '</b></td><td class="num"><b>' + d.issueCount + '</b></td></tr></tbody></table></div>' +
      '<div class="tiny subtle mt-1">' + esc(T('rep.severityLine')) + ' — ' + esc(T('rep.high')) + ': ' + (sev.high || 0) +
      ' · ' + esc(T('rep.medium')) + ': ' + (sev.medium || 0) + ' · ' + esc(T('rep.low')) + ': ' + (sev.low || 0) + '</div>' +
      '</div></div>' +

      '<div class="section-head mt-4"><span class="no">02</span><h2>' + esc(T('rep.examples')) + '</h2><span class="rule"></span>' +
      '<span class="badge">' + d.fullExamplesShown + ' / ' + d.issueCount + ' ' + esc(T('rep.shownFull')) + '</span></div>' +
      ((sev.high || 0) > 0
        ? '<div class="priority-head"><span class="sev high"><i class="sev-dot"></i>' + esc(T('rep.high')) + '</span>' +
          '<h3>' + esc(T('rep.priority')) + '</h3></div>' +
          '<div class="notice warn tiny" style="margin-top:0">' + esc(T('rep.priorityDesc')) + '</div>'
        : '') +
      (examples || '<div class="notice ok">' + esc(T('rep.noIssues')) + '</div>') +

      (summaries
        ? '<div class="section-head mt-4"><span class="no">03</span><h2>' + esc(T('rep.remaining')) + '</h2><span class="rule"></span>' +
          '<span class="badge">' + Math.min(30, (d.summaries || []).length) + ' / ' + (d.summaries || []).length + ' ' + esc(T('rep.summariesCount')) + '</span></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(T('rep.type')) + '</th><th>' + esc(T('rep.severity')) + '</th><th>' + esc(T('rep.location')) + '</th><th>' + esc(T('rep.excerpt')) + '</th></tr></thead><tbody>' + summaries + '</tbody></table></div>' +
          '<div class="notice info mt-2 tiny">' + esc(d.paywallNote || '') + '</div>'
        : '') +

      // Professional human service CTA
      '<div class="entries mt-4"><div class="entry-card paper" style="grid-column:1/-1">' +
      '<span class="card-no">PRO</span><span class="badge yellow">' + esc(T('rep.proBadge')) + '</span>' +
      '<h2>' + esc(T('rep.ctaTitle')) + '</h2>' +
      '<p class="muted small mt-1" style="max-width:560px">' + esc(T('rep.ctaDesc')) + '</p>' +
      '<div class="cta-row mt-2"><a class="btn primary" href="/professional?audit=' + encodeURIComponent(d.id) + '">' + esc(T('rep.ctaBtn')) + '</a>' +
      '<a class="btn" href="/translate">' + esc(T('rep.ctaAlt')) + '</a></div>' +
      '</div></div>' +

      (d.shareToken ? '<div class="notice info tiny mt-2"><b>' + esc(T('rep.shareLabel')) + '</b> <a href="?t=' + esc(d.shareToken) + '">' + esc(T('rep.shareLink')) + '</a> ' + esc(T('rep.shareHint')) + '</div>' : '') +
      '<p class="tiny subtle mt-2">' + esc(T('rep.freeNote')) + '</p>';
    animateRings();
  }
})();
