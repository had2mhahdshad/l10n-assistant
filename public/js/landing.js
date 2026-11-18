/* Landing page — hand the URL typed in the hero to the checker form. */
(function () {
  'use strict';
  var form = document.getElementById('heroUrlForm');
  var input = document.getElementById('heroUrl');
  if (!form || !input) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = input.value.trim();
    if (!url) { input.focus(); return; }
    try { sessionStorage.setItem('l10n_prefill_url', url); } catch (err) {}
    window.location.href = '/checker';
  });
})();
