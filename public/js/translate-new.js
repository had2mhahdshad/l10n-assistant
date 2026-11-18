/* New translation job page — paste/upload JSON, configure, create job. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T = window.T || function (k) { return k; };

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

  $('createJob').addEventListener('click', function () {
    var json;
    try { json = JSON.parse($('jsonInput').value); }
    catch (e) { return status('✕ ' + T('trn.invalidJson') + e.message, 'error'); }

    var targets = Array.prototype.slice.call(document.querySelectorAll('.t-target:checked')).map(function (c) { return c.value; });
    if (!targets.length) return status('✕ ' + T('trn.selectTarget'), 'error');

    var body = {
      projectName: $('projectName').value.trim() || undefined,
      filename: $('filename').value.trim() || 'common.json',
      sourceLanguage: $('tSourceLang').value,
      targetLanguages: targets,
      json: json,
      productType: $('productType').value.trim() || undefined,
      context: $('context').value.trim() || undefined,
      style: $('style').value,
      brandTerms: $('brandTerms').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      ignoreKeys: $('ignoreKeys').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };

    status('<span class="spinner"></span> ' + T('trn.creatingMsg'), 'info');
    fetch('/api/translate/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) return status('✕ ' + (r.d.error || T('trn.failedCreate')), 'error');
        status('✓ ' + T('trn.jobCreated') + ' — ' + r.d.stats.translatable + ' ' + T('trn.translatable') + ' × ' +
          body.targetLanguages.length + ' ' + T('trn.locales') + '. ' + T('trn.opening'), 'ok');
        setTimeout(function () { location.href = '/translate/jobs/' + r.d.jobId; }, 700);
      })
      .catch(function (e) { status('✕ ' + T('ck.netErr') + e.message, 'error'); });
  });

  function status(html, cls) {
    $('createStatus').innerHTML = '<span class="notice ' + (cls || 'info') + '" style="display:inline-block;margin:0;padding:6px 12px">' + html + '</span>';
  }
})();
