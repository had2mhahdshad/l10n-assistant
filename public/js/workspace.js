/* Translation workspace — bilingual editor, filters, QA, export. */
(function () {
  'use strict';
  var root = document.getElementById('wsRoot');
  var jobId = document.querySelector('[data-job-id]').getAttribute('data-job-id');
  var state = { q: '', status: '', issueType: '', locale: '' };
  var data = null;
  var shareToken = new URLSearchParams(location.search).get('t') || '';
  var T = window.T || function (k) { return k; };
  function tokenQs() { return shareToken ? '&t=' + encodeURIComponent(shareToken) : ''; }
  function statusLabel(s) { var k = 'st.' + s; var v = T(k); return v === k ? s : v; }
  var readOnly = false; // true when opened through a read-only share link
  var lastMsg = null; // survives re-render so action feedback is not lost
  var fontRecs = {}; // locale -> recommendation payload (loaded on demand)

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function api(url, opts) {
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (d) {
        if (!res.ok) { var e = new Error(d.error || ('HTTP ' + res.status)); e.data = d; e.status = res.status; throw e; }
        return d;
      });
    });
  }

  function load() {
    var qs = [];
    if (state.q) qs.push('q=' + encodeURIComponent(state.q));
    if (state.status) qs.push('status=' + encodeURIComponent(state.status));
    if (state.issueType) qs.push('issueType=' + encodeURIComponent(state.issueType));
    if (state.locale) qs.push('locale=' + encodeURIComponent(state.locale));
    if (shareToken) qs.push('t=' + encodeURIComponent(shareToken));
    api('/api/translate/jobs/' + jobId + (qs.length ? '?' + qs.join('&') : ''))
      .then(function (d) { data = d; readOnly = !!d.readOnly; render(); })
      .catch(function (e) { root.innerHTML = '<div class="notice error">' + esc(e.message) + '</div>'; });
  }

  function qaLabel(t) { var k = 'ws.q.' + t; var v = T(k); return v === k ? (ISSUE_LABEL[t] || t) : v; }
  var ISSUE_LABEL = {
    placeholder: 'Placeholder', html_integrity: 'HTML', url_change: 'URL',
    empty_translation: 'Empty', duplicate_translation: 'Duplicate',
    terminology: 'Terminology', language_mismatch: 'Language',
    ui_length: 'UI Length', structure_missing_node: 'Structure',
    key_count_mismatch: 'Key Count'
  };

  function render() {
    var j = data.job, p = data.project;
    var issueByKey = {};
    (data.qualityIssues || []).forEach(function (i) {
      var k = i.locale + '::' + i.entryKey;
      (issueByKey[k] = issueByKey[k] || []).push(i);
    });

    var statusCounts = {};
    data.entries.forEach(function (e) { statusCounts[e.status] = (statusCounts[e.status] || 0) + 1; });

    // ── URL scan coverage + Free quota + optional font panel ────────────
    var q = data.quota || null;
    var scan = data.scanMeta || null;
    var extra = '';

    if (scan) {
      var lim = (scan.limitations || []).map(function (k) { return '<li>' + esc(T(k)) + '</li>'; }).join('');
      extra += '<div class="notice warn mt-3"><b>' + esc(T('ws.urlNoticeTitle')) + '</b>' +
        '<div class="small mt-1">' + esc(T('ws.sourceType.url')) + ' · ' +
          '<a class="report-url" href="' + esc(scan.startUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(scan.startUrl) + '</a></div>' +
        '<div class="small mt-1">' +
          esc(T('url.scannedLabel')) + ': <b>' + (scan.scannedPages || 0) + '</b> / ' + (scan.maxPages || 0) +
          ' · ' + esc(T('url.failedLabel')) + ': ' + (scan.failedPages || 0) +
          ' · ' + esc(T('url.discoveredLabel')) + ': ' + (scan.discoveredPages || 0) +
          ' · ' + esc(T('url.segmentLabel')) + ': ' + (scan.segmentCount || 0) + '</div>' +
        '<ul class="nt-list">' + lim + '</ul></div>';
    }

    if (q) {
      var lockedSample = (data.lockedKeys || []).slice(0, 12)
        .map(function (k) { return '<code class="mono tiny">' + esc(k) + '</code>'; }).join(' ');
      var unlock = data.unlock || {};
      extra += '<div class="quota-bar paper mt-3">' +
        '<div class="quota-head"><b>' + esc(T('ws.quotaTitle')) + '</b>' +
          '<span class="badge ' + (q.paywall ? 'yellow' : 'green') + '">' +
            (q.paywall ? esc(T('url.partialBadge')) : 'OK') + '</span></div>' +
        '<div class="quota-stats">' +
          '<div><div class="qnum">' + (q.usedUnits || 0) + '</div><div class="qlabel">' + esc(T('ws.quotaUsed')) + '</div></div>' +
          '<div><div class="qnum">' + (q.freeUnitsRemaining || 0) + '</div><div class="qlabel">' + esc(T('ws.quotaRemaining')) + '</div></div>' +
          '<div class="risk"><div class="qnum">' + (data.lockedStrings || 0) + '</div><div class="qlabel">' + esc(T('ws.quotaLocked')) + '</div></div>' +
        '</div>' +
        '<div class="small mt-2">' + esc(T('ws.quotaPaywall')) + '</div>' +
        (q.paywall
          ? '<div class="quota-unlock mt-2"><a class="btn sm" href="' + esc(unlock.url || '/professional') +
              '?job=' + encodeURIComponent(jobId) + '">' + esc(unlock.label || T('ws.unlockBtn')) + ' →</a>' +
            '<span class="tiny subtle">' + esc(unlock.note || T('ws.unlockNote')) + '</span></div>'
          : '') +
        ((data.lockedKeys || []).length
          ? '<details class="mt-2"><summary class="tiny">' + esc(T('ws.lockedKeysTitle')) + '</summary>' +
            '<div class="mt-1">' + lockedSample + '</div></details>' : '') +
        '</div>';
    }

    if (!readOnly || (data.fontConfig && data.fontConfig.selections && data.fontConfig.selections.length)) {
      var fontSelects = p.targetLanguages.map(function (l) {
        return '<div class="cfg-line"><label for="font_' + esc(l) + '">' + esc(l.toUpperCase()) + '</label>' +
          '<select class="font-pick" id="font_' + esc(l) + '" data-lang="' + esc(l) + '"><option value="">—</option></select></div>';
      }).join('');
      extra += '<details class="font-panel paper mt-3" id="fontPanel">' +
        '<summary>' + esc(T('font.title')) + '</summary>' +
        '<div class="small subtle mt-2">' + esc(T('font.sub')) + '</div>' +
        '<div class="mt-2">' + fontSelects + '</div>' +
        '<div id="fontDetail" class="mt-2"></div>' +
        (readOnly ? '' : '<button class="btn sm" id="saveFonts">' + esc(T('ws.saveFonts')) + '</button>') +
        '<div class="mt-2"><a class="btn sm ghost" href="/api/translate/jobs/' + jobId +
          '/export?format=package' + tokenQs() + '">' + esc(T('ws.exportPackage')) + '</a></div>' +
        '<div class="tiny subtle mt-2">' + esc(T('font.notBundled')) + ' ' + esc(T('font.notPreview')) + '</div>' +
        '</details>';
    }

    var rows = data.entries.map(function (e) {
      var flags = issueByKey[e.locale + '::' + e.key] || [];
      var cls = e.status === 'failed' ? 'failed' : flags.length ? 'flagged' : e.manuallyEdited ? 'edited' : '';
      var flagHtml = flags.map(function (f) {
        return '<div class="tiny" style="margin-top:3px"><span class="sev ' + f.severity + '">' + f.severity + '</span> ' +
          esc(qaLabel(f.issueType)) + ': ' + esc(f.description) + '</div>';
      }).join('');
      return '<div class="ws-row ' + cls + '" data-id="' + e.id + '">' +
        '<div><div class="k">' + esc(e.key) + '</div><span class="locale badge">' + esc(e.locale) + '</span></div>' +
        '<div><div class="src">' + esc(e.sourceText) + '</div><div class="chars">' + e.sourceChars + ' chars</div></div>' +
        '<div><textarea class="dst-edit" data-id="' + e.id + '" spellcheck="false"' + (readOnly ? ' readonly' : '') + '>' + esc(e.translatedText || '') + '</textarea>' +
        '<div class="chars">' + e.translatedChars + ' ' + esc(T('ws.chars')) + '</div>' + flagHtml + '</div>' +
        '<div><span class="badge ' + (e.status === 'completed' || e.status === 'approved' ? 'green' : e.status === 'failed' ? 'red' : e.status === 'needs_review' ? 'yellow' : '') + '">' + esc(statusLabel(e.status)) + '</span>' +
        (e.manuallyEdited ? '<div class="tiny mt-1"><span class="badge green">MANUAL</span></div>' : '') + '</div>' +
        '<div><div class="row-actions">' +
        (readOnly
          ? '<span class="tiny subtle">' + esc(T('ws.readOnly')) + '</span>'
          : '<button class="btn sm act-save" data-id="' + e.id + '">Save</button>' +
            '<button class="btn sm ghost act-re" data-id="' + e.id + '">Retranslate</button>' +
            '<button class="btn sm ghost act-approve" data-id="' + e.id + '">Approve</button>' +
            '<button class="btn sm ghost act-skip" data-id="' + e.id + '">Skip</button>') +
        '</div></div>' +
        '</div>';
    }).join('');

    var issueTypes = Array.from(new Set((data.qualityIssues || []).map(function (i) { return i.issueType; })));

    root.innerHTML =
      '<div class="section-head"><span class="no">WS</span><h2>' + esc(p.name) + '</h2><span class="rule"></span>' +
      '<span class="badge ' + (j.status === 'completed' ? 'green' : j.status === 'failed' ? 'red' : 'blue') + '">' + esc(statusLabel(j.status)) + '</span></div>' +
      '<div class="tiny muted mono mb-2">' + esc(p.sourceLanguage) + ' → ' + p.targetLanguages.join(' / ').toUpperCase() +
      ' · ' + esc(j.filename) + ' · ' + esc(T('ws.model')) + ' ' + esc(j.model || '—') +
      ' · ' + esc(T('ws.tokens')) + ': ' + (j.tokenUsage || 0) + ' · ' + esc(T('ws.cost')) + ' $' + Number(j.estimatedCost || 0).toFixed(6) + '</div>' +

      '<div class="ws">' +
      '<div class="ws-toolbar paper">' +
      (readOnly
        ? '<span class="badge">' + esc(T('ws.readOnlyBadge')) + '</span>'
        : '<button class="btn sm primary" id="runAll">' + esc(T('ws.translateAll')) + '</button>' +
          '<button class="btn sm" id="runQa">' + esc(T('ws.runQa')) + '</button>') +
      '<span class="spacer"></span>' +
      '<input type="search" id="fQ" placeholder="' + esc(T('ws.search')) + '" value="' + esc(state.q) + '" />' +
      '<select id="fLocale"><option value="">' + esc(T('ws.allLocales')) + '</option>' +
      p.targetLanguages.map(function (l) { return '<option ' + (state.locale === l ? 'selected' : '') + ' value="' + l + '">' + l.toUpperCase() + '</option>'; }).join('') + '</select>' +
      '<select id="fStatus"><option value="">' + esc(T('ws.allStatuses')) + '</option>' +
      ['pending', 'translating', 'completed', 'needs_review', 'approved', 'failed', 'skipped'].map(function (s) {
        return '<option ' + (state.status === s ? 'selected' : '') + ' value="' + s + '">' + esc(statusLabel(s)) + '</option>';
      }).join('') + '</select>' +
      '<select id="fIssue"><option value="">' + esc(T('ws.allIssues')) + '</option>' +
      issueTypes.map(function (t) { return '<option ' + (state.issueType === t ? 'selected' : '') + ' value="' + t + '">' + esc(ISSUE_LABEL[t] || t) + '</option>'; }).join('') + '</select>' +
      '</div>' +
      '<div class="ws-toolbar paper tiny">' +
      '<span>' + esc(T('ws.export')) + '</span>' +
      p.targetLanguages.map(function (l) {
        return '<a class="btn sm ghost" href="/api/translate/jobs/' + jobId + '/export?format=json&locale=' + l + (shareToken ? '&t=' + encodeURIComponent(shareToken) : '') + '">' + l.toUpperCase() + ' ' + esc(T('ws.exportJson')) + '</a>';
      }).join('') +
      '<a class="btn sm ghost" href="/api/translate/jobs/' + jobId + '/export?format=zip' + tokenQs() + '">' + esc(T('ws.exportZip')) + '</a>' +
      '<a class="btn sm" href="/api/translate/jobs/' + jobId + '/export?format=package' + tokenQs() + '">' + esc(T('ws.exportPackage')) + '</a>' +
      '<a class="btn sm ghost" href="/api/translate/jobs/' + jobId + '/export?format=csv' + tokenQs() + '">' + esc(T('ws.exportCsv')) + '</a>' +
      '<a class="btn sm ghost" href="/api/translate/jobs/' + jobId + '/export?format=report' + tokenQs() + '">' + esc(T('ws.exportReport')) + '</a>' +
      '<span class="spacer"></span><span id="wsMsg">' + (lastMsg ? badge(lastMsg.html, lastMsg.cls) : '') + '</span>' +
      '</div>' +
      '<div class="ws-head"><div>' + esc(T('ws.colKey')) + '</div><div>' + esc(T('ws.colSource')) + '</div><div>' + esc(T('ws.colTranslation')) + '</div><div>' + esc(T('ws.colStatus')) + '</div><div>' + esc(T('ws.colActions')) + '</div></div>' +
      '<div class="ws-grid">' + (rows || '<div class="notice info" style="margin:12px">' + esc(T('ws.noMatch')) + '</div>') + '</div>' +
      '</div>' +
      '<div class="tiny subtle mt-1">' + esc(T('ws.manualNote')) + '</div>' +
      (data.shareToken && !readOnly
        ? '<div class="notice info tiny mt-2"><b>' + esc(T('ws.shareLabel')) + '</b> ' +
          '<a href="?t=' + esc(data.shareToken) + '">' + esc(T('rep.shareLink')) + '</a> ' + esc(T('ws.shareHint')) + '</div>'
        : '') + extra;

    bind();
  }

  function bind() {
    bindFonts();
    if (readOnly) { // no write controls rendered
      Array.prototype.forEach.call(document.querySelectorAll('.act-save,.act-re,.act-approve,.act-skip'), function (b) { b.disabled = true; });
      return;
    }
    document.getElementById('runAll').addEventListener('click', function () {
      var hasManual = data.entries.some(function (e) { return e.manuallyEdited; });
      var url = '/api/translate/jobs/' + jobId + '/run';
      if (hasManual) msg(esc(T('ws.manualNote')), 'info');
      msg('<span class="spinner"></span> ' + esc(T('ws.running')), 'info');
      api(url, { method: 'POST' })
        .then(function (r) {
          msg('✓ ' + r.translated + ' ' + esc(T('ws.runDone')) + ', ' + r.failed + ' ' + esc(T('ws.failedWord')) + ' · ' + r.tokens + ' ' + esc(T('ws.tokens')) + ' · $' + r.costUsd.toFixed(6) + ' (' + esc(r.model || '') + ')', 'ok');
          load();
        })
        .catch(function (e) { msg('✕ ' + esc(e.message), 'error'); load(); });
    });

    document.getElementById('runQa').addEventListener('click', function () {
      msg('<span class="spinner"></span> ' + esc(T('ws.qaRunning')), 'info');
      api('/api/translate/jobs/' + jobId + '/qa', { method: 'POST' })
        .then(function (r) { msg('✓ ' + esc(T('ws.qaDone')) + ' ' + r.issueCount, 'ok'); load(); })
        .catch(function (e) { msg('✕ ' + esc(e.message), 'error'); });
    });

    var debounce;
    document.getElementById('fQ').addEventListener('input', function (e) {
      clearTimeout(debounce);
      debounce = setTimeout(function () { state.q = e.target.value; load(); }, 350);
    });
    document.getElementById('fStatus').addEventListener('change', function (e) { state.status = e.target.value; load(); });
    document.getElementById('fIssue').addEventListener('change', function (e) { state.issueType = e.target.value; load(); });
    document.getElementById('fLocale').addEventListener('change', function (e) { state.locale = e.target.value; load(); });

    Array.prototype.forEach.call(document.querySelectorAll('.act-save'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var text = document.querySelector('textarea.dst-edit[data-id="' + id + '"]').value;
        api('/api/translate/entries/' + id, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ translatedText: text })
        }).then(function () { msg('✓ ' + esc(T('ws.saved')), 'ok'); load(); })
          .catch(function (e) { msg('✕ ' + esc(e.message), 'error'); });
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.act-re'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        btn.disabled = true;
        api('/api/translate/entries/' + id + '/retranslate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then(function () { msg('✓ ' + esc(T('ws.retranslated')), 'ok'); load(); })
          .catch(function (e) {
            if (e.status === 409 && confirm(e.message + '\n\n' + T('ws.confirmOverwrite'))) {
              return api('/api/translate/entries/' + id + '/retranslate', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ force: true })
              }).then(function () { msg('✓ ' + esc(T('ws.overwritten')), 'ok'); load(); });
            }
            if (e.status !== 409) msg('✕ ' + esc(e.message), 'error');
          })
          .finally(function () { btn.disabled = false; });
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.act-approve'), function (btn) {
      btn.addEventListener('click', function () {
        api('/api/translate/entries/' + btn.getAttribute('data-id'), {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'approved' })
        }).then(load).catch(function (e) { msg('✕ ' + esc(e.message), 'error'); });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.act-skip'), function (btn) {
      btn.addEventListener('click', function () {
        api('/api/translate/entries/' + btn.getAttribute('data-id'), {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'skipped' })
        }).then(load).catch(function (e) { msg('✕ ' + esc(e.message), 'error'); });
      });
    });
  }

  // ── Font recommendation (independent of the JSON translation) ─────────
  function linkHost(u) { try { return new URL(u).host; } catch (e) { return 'link'; } }
  function loadFonts() {
    (data.project.targetLanguages || []).forEach(function (l) {
      fetch('/api/fonts/recommend?lang=' + encodeURIComponent(l))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          fontRecs[l] = d;
          var sel = document.getElementById('font_' + l);
          if (!sel) return;
          (d.recommendations || []).forEach(function (f) {
            var o = document.createElement('option');
            o.value = f.id;
            o.textContent = f.name + ' · ' + f.provider;
            sel.appendChild(o);
          });
          var saved = ((data.fontConfig && data.fontConfig.selections) || [])
            .filter(function (x) { return x.lang === l; })[0];
          if (saved) sel.value = saved.fontId;
          renderFontDetail();
        }).catch(function () { /* leave the select empty */ });
    });
  }

  function renderFontDetail() {
    var el = document.getElementById('fontDetail');
    if (!el) return;
    var parts = [];
    Object.keys(fontRecs).forEach(function (l) {
      var sel = document.getElementById('font_' + l);
      if (!sel || !sel.value) return;
      var f = ((fontRecs[l].recommendations) || []).filter(function (x) { return x.id === sel.value; })[0];
      if (!f) return;
      var prov = T('font.provider.' + f.provider);
      parts.push('<div class="font-card">' +
        '<div class="font-card-head"><b>' + esc(l.toUpperCase()) + ' · ' + esc(f.name) + '</b>' +
        '<span class="badge">' + esc(prov === 'font.provider.' + f.provider ? f.provider : prov) + '</span></div>' +
        '<div class="tiny">' + esc(T('font.license')) + ': ' + esc(f.license.name) +
          (f.license.url ? ' <a href="' + esc(f.license.url) + '" target="_blank" rel="noopener noreferrer">↗</a>' : '') + '</div>' +
        '<div class="tiny">' + esc(T('font.scope')) + ': ' + esc(f.license.scope) + '</div>' +
        (f.sourceUrl ? '<div class="tiny">' + esc(T('font.source')) + ': <a href="' + esc(f.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(linkHost(f.sourceUrl)) + ' ↗</a></div>' : '') +
        (f.downloadUrl ? '<div class="tiny">' + esc(T('font.download')) + ': <a href="' + esc(f.downloadUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(linkHost(f.downloadUrl)) + ' ↗</a></div>' : '') +
        '<div class="tiny muted">' + esc(f.fileAvailable ? T('font.fileAvailable') : T('font.fileNotAvailable')) + '</div>' +
        '<div class="tiny mt-1"><a href="/api/fonts/css?lang=' + encodeURIComponent(l) + '&fontId=' + encodeURIComponent(f.id) + '">' + esc(T('font.downloadCss')) + '</a> · ' +
        '<a href="/api/fonts/package?lang=' + encodeURIComponent(l) + '&fontId=' + encodeURIComponent(f.id) + '">' + esc(T('font.downloadPack')) + '</a></div>' +
        '</div>');
    });
    el.innerHTML = parts.join('') || '<div class="tiny subtle">' + esc(T('font.pickLabel')) + '</div>';
  }

  function bindFonts() {
    var panel = document.getElementById('fontPanel');
    if (!panel) return;
    Array.prototype.forEach.call(document.querySelectorAll('.font-pick'), function (sel) {
      sel.addEventListener('change', renderFontDetail);
    });
    var save = document.getElementById('saveFonts');
    if (save) save.addEventListener('click', function () {
      var selections = [];
      Array.prototype.forEach.call(document.querySelectorAll('.font-pick'), function (sel) {
        if (sel.value) selections.push({ lang: sel.getAttribute('data-lang'), fontId: sel.value });
      });
      fetch('/api/translate/jobs/' + jobId + '/fonts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selections: selections })
      }).then(function (r) { return r.json(); }).then(function (d) {
        data.fontConfig = { selections: d.selections || [] };
        msg('✓ ' + esc(T('font.saved')), 'ok');
      }).catch(function (e) { msg('✕ ' + esc(e.message), 'error'); });
    });
    loadFonts();
  }

  function badge(html, cls) {
    return '<span class="badge ' + (cls === 'error' ? 'red' : cls === 'ok' ? 'green' : 'blue') + '">' + html + '</span>';
  }

  function msg(html, cls) {
    lastMsg = { html: html, cls: cls };
    var el = document.getElementById('wsMsg');
    if (el) el.innerHTML = badge(html, cls);
  }

  load();
})();
