/* Professional service lead form — submits to /api/leads, links audit context. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T = window.T || function (k) { return k; };
  var auditId = document.querySelector('[data-audit-id]').getAttribute('data-audit-id');

  if (auditId) {
    $('auditLinkNote').innerHTML =
      '<div class="notice info tiny"><b>' + T('pro.linkedLabel') + '</b> ' + T('pro.linkedDesc') + '</div>';
  }

  $('submitLead').addEventListener('click', function () {
    var langs = Array.prototype.slice.call(document.querySelectorAll('.lead-lang:checked')).map(function (c) { return c.value; });
    var body = {
      auditJobId: auditId || undefined,
      email: $('leadEmail').value.trim(),
      productName: $('leadProduct').value.trim() || undefined,
      targetLanguages: langs,
      serviceType: $('leadType').value,
      estimatedWordCount: $('leadWords').value ? Number($('leadWords').value) : undefined,
      description: $('leadDesc').value.trim() || undefined,
      needsHumanReview: $('leadReview').checked
    };

    setStatus('<span class="spinner"></span> ' + T('pro.submitting'), 'info');
    fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) return setStatus('✕ ' + (r.d.error || T('pro.failed')), 'error');
        setStatus('✓ <b>' + T('pro.success') + '</b><br /><span class="tiny subtle">' + T('pro.reference') + ' ' + r.d.id + '</span>', 'ok');
        $('submitLead').disabled = true;
      })
      .catch(function (e) { setStatus('✕ ' + T('ck.netErr') + e.message, 'error'); });
  });

  function setStatus(html, cls) {
    $('leadStatus').innerHTML = '<div class="notice ' + (cls || 'info') + '">' + html + '</div>';
  }
})();
