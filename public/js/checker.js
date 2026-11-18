/* Checker page logic — two independent tabs: website scan / JSON audit. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T = window.T || function (k) { return k; };

  $('tabWebsite').addEventListener('click', function () { switchTab('Website'); });
  $('tabJson').addEventListener('click', function () { switchTab('Json'); });

  function switchTab(name) {
    $('tabWebsite').classList.toggle('active', name === 'Website');
    $('tabJson').classList.toggle('active', name === 'Json');
    $('paneWebsite').classList.toggle('hidden', name !== 'Website');
    $('paneJson').classList.toggle('hidden', name !== 'Json');
  }

  function status(html, cls) {
    $('checkerStatus').innerHTML = '<div class="notice ' + (cls || 'info') + '">' + html + '</div>';
  }

  function fail(msg) { status('✕ ' + escapeHtml(msg), 'error'); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  $('runWebsite').addEventListener('click', function () {
    var body = {
      websiteUrl: $('websiteUrl').value.trim(),
      targetUrl: $('targetUrl').value.trim() || undefined,
      sourceLanguage: $('sourceLang').value,
      targetLanguage: $('targetLang').value
    };
    if (!body.websiteUrl) return fail(T('ck.needUrl'));
    if (body.sourceLanguage === body.targetLanguage) return fail(T('ck.langSame'));
    run('/api/audit', body, T('ck.scanning'));
  });

  $('runJson').addEventListener('click', function () {
    var src, tgt = null;
    try { src = JSON.parse($('jsonSource').value); } catch (e) { return fail(T('ck.srcInvalid') + e.message); }
    var tgtRaw = $('jsonTarget').value.trim();
    if (tgtRaw) {
      try { tgt = JSON.parse(tgtRaw); } catch (e) { return fail(T('ck.tgtInvalid') + e.message); }
    }
    var body = {
      sourceJson: src,
      targetJson: tgt,
      sourceLanguage: $('jsonSourceLang').value,
      targetLanguage: $('jsonTargetLang').value
    };
    run('/api/audit/json', body, T('ck.auditing'));
  });

  function run(url, body, waitingMsg) {
    status('<span class="spinner"></span> ' + waitingMsg + '<div class="progress-line mt-2"><i></i></div>', 'info');
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        if (!r.ok) {
          if (r.data.needsTargetUrl) {
            status('⚠ ' + escapeHtml(r.data.error) + '<br /><br /><b>' + escapeHtml(T('ck.nextStep')) + '</b> ' + escapeHtml(T('ck.nextStepHint')), 'warn');
            return;
          }
          return fail(r.data.error || T('ck.failed'));
        }
        status('✓ ' + escapeHtml(T('ck.done')), 'ok');
        setTimeout(function () { location.href = '/report/' + r.data.id; }, 600);
      })
      .catch(function (e) { fail(T('ck.netErr') + e.message); });
  }
})();
