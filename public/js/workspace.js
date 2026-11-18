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
        : '');

    bind();
  }

  function bind() {
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
