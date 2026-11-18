/* Admin leads dashboard — token-gated. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T = window.T || function (k) { return k; };

  var saved = sessionStorage.getItem('l10n_admin_token');
  if (saved) $('adminToken').value = saved;

  $('loadLeads').addEventListener('click', function () {
    var token = $('adminToken').value.trim();
    sessionStorage.setItem('l10n_admin_token', token);
    fetch('/api/admin/leads', { headers: { 'x-admin-token': token } })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        if (!r.ok) { $('leadsRoot').innerHTML = '<div class="notice error">' + (r.d.error || 'Unauthorized.') + '</div>'; return; }
        render(r.d.leads, token);
      })
      .catch(function (e) { $('leadsRoot').innerHTML = '<div class="notice error">' + e.message + '</div>'; });
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render(leads, token) {
    if (!leads.length) { $('leadsRoot').innerHTML = '<div class="notice info">' + esc(T('admin.empty')) + '</div>'; return; }
    var rows = leads.map(function (l) {
      var ac = l.auditContext;
      return '<tr>' +
        '<td class="small">' + esc(l.createdAt).slice(0, 16).replace('T', ' ') + '</td>' +
        '<td><b>' + esc(l.email) + '</b><br /><span class="tiny muted">' + esc(l.productName || '—') + '</span></td>' +
        '<td class="small">' + l.targetLanguages.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join(' ') + '</td>' +
        '<td class="small">' + esc(l.serviceType) + (l.estimatedWordCount ? '<br /><span class="tiny muted">~' + l.estimatedWordCount + ' ' + esc(T('admin.wordsShort')) + '</span>' : '') + '</td>' +
        '<td class="tiny mono">' + (ac
          ? 'score ' + (ac.localizationScore == null ? 'N/E' : ac.localizationScore) + ' · ' + ac.issueCount + ' issues · ' + ac.scannedPages + ' pages<br />' + esc(ac.websiteUrl)
          : '—') + '</td>' +
        '<td class="small">' + esc(l.description || '—') + '</td>' +
        '<td><select data-id="' + l.id + '" class="lead-status">' +
        ['new', 'contacted', 'quoted', 'won', 'lost'].map(function (s) {
          return '<option ' + (l.status === s ? 'selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></td>' +
        '</tr>';
    }).join('');

    $('leadsRoot').innerHTML =
      '<table class="tbl"><thead><tr><th>' + esc(T('admin.date')) + '</th><th>' + esc(T('admin.contact')) + '</th><th>' + esc(T('admin.langs')) + '</th><th>' + esc(T('admin.type')) + '</th><th>' + esc(T('admin.context')) + '</th><th>' + esc(T('admin.notes')) + '</th><th>' + esc(T('admin.status')) + '</th></tr></thead><tbody>' +
      rows + '</tbody></table><div class="tiny subtle mt-1">' + leads.length + ' ' + esc(T('admin.leadCount')) + '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.lead-status'), function (sel) {
      sel.addEventListener('change', function () {
        fetch('/api/admin/leads/' + sel.getAttribute('data-id'), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-admin-token': token },
          body: JSON.stringify({ status: sel.value })
        });
      });
    });
  }
})();
