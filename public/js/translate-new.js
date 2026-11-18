/* New translation job: Website URL OR JSON upload. Both are independent of
   the free Localization Checker; the chosen input decides the API endpoint. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T = window.T || function (k) { return k; };
  var tab = 'json';

  function status(html, cls) {
    $('createStatus').innerHTML = '<span class="notice ' + (cls || 'info') + '" style="display:inline-block;margin:0;padding:6px 12px">' + html + '</span>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function setTab(next) {
    tab = next;
    $('tabJson').classList.toggle('active', tab === 'json');
    $('tabUrl').classList.toggle('active', tab === 'url');
    $('paneJson').classList.toggle('hidden', tab !== 'json');
    $('paneUrl').classList.toggle('hidden', tab !== 'url');
    $('createJob').textContent = tab === 'url' ? T('url.submit') : T('tr.create');
  }

  $('tabJson').addEventListener('click', function () { setTab('json'); });
  $('tabUrl').addEventListener('click', function () { setTab('url'); });

  $('jsonFile').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { $('fileName').textContent = T('trn.tooLarge'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      $('jsonInput').value = reader.result;
      $('fileName').textContent = f.name;
      if (!$('filename').value || $('filename').value === 'common.json') $('filename').value = f.name;
    };
    reader.readAsText(f);
  });

  function commonBody() {
    return {
      projectName: $('projectName').value.trim() || undefined,
      filename: $('filename').value.trim() || 'common.json',
      sourceLanguage: $('tSourceLang').value,
      targetLanguages: Array.prototype.slice.call(document.querySelectorAll('.t-target:checked')).map(function (c) { return c.value; }),
      productType: $('productType').value.trim() || undefined,
      context: $('context').value.trim() || undefined,
      style: $('style').value,
      brandTerms: $('brandTerms').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      ignoreKeys: $('ignoreKeys').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };
  }

  $('createJob').addEventListener('click', function () {
    var body = commonBody();
    if (!body.targetLanguages.length) return status('✕ ' + T('trn.selectTarget'), 'error');

    var endpoint = '/api/translate/jobs';
    if (tab === 'url') {
      var url = $('websiteUrl').value.trim();
      if (!url) return status('✕ ' + T('ck.needUrl'), 'error');
      body.websiteUrl = url;
      endpoint = '/api/translate/url';
    } else {
      try { body.json = JSON.parse($('jsonInput').value); }
      catch (e) { return status('✕ ' + T('trn.invalidJson') + e.message, 'error'); }
    }

    status('<span class="spinner"></span> ' + (tab === 'url' ? T('ck.scanning') : T('trn.creatingMsg')), 'info');
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) return status('✕ ' + esc(r.d.error || T('trn.failedCreate')), 'error');
        var d = r.d, extra = '';
        if (d.scan) {
          extra = ' · ' + esc(T('url.scannedLabel')) + ' ' + d.scan.scannedPages +
            ' / ' + d.scan.maxPages + (d.scan.failedPages ? ' · ' + esc(T('url.failedLabel')) + ' ' + d.scan.failedPages : '');
        }
        var q = (d.stats && d.stats.quota) || {};
        if (q.paywall) {
          extra += ' · <b>' + esc(T('ws.quotaLocked')) + ' ' + (q.locked ? q.locked.units : 0) + '</b>';
        }
        status('✓ ' + T('trn.jobCreated') + ' — ' + d.stats.translatable + ' ' + T('trn.translatable') +
          ' × ' + body.targetLanguages.length + ' ' + T('trn.locales') + extra + '. ' + T('trn.opening'), 'ok');
        setTimeout(function () { location.href = '/translate/jobs/' + d.jobId; }, 900);
      })
      .catch(function (e) { status('✕ ' + T('ck.netErr') + e.message, 'error'); });
  });

  setTab('json');
})();
