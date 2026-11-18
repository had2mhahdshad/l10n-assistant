/* Shared front-end for the free Localization Checker:
   1) JSON file upload / drag & drop (home widget + checker JSON tab)
   2) "how to get a full-copy JSON" guide toggle
   3) the landing hero widget that runs /api/audit or /api/audit/json in place
   Vanilla JS, no build step. */
(function () {
  'use strict';
  var T = window.T || function (k) { return k; };
  var $ = function (id) { return document.getElementById(id); };
  var MAX = 5 * 1024 * 1024;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── 1. File upload / drop ───────────────────────────────── */
  function bindDropzone(input) {
    var target = $(input.getAttribute('data-json-target'));
    var label = $(input.getAttribute('data-file-label'));
    var zone = input.closest ? input.closest('.dropzone') : null;
    if (!target) return;

    function load(file) {
      if (!file) return;
      if (file.size > MAX) {
        if (label) { label.textContent = T('trn.tooLarge'); label.classList.add('is-error'); }
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        target.value = String(reader.result || '');
        if (label) {
          label.textContent = T('free.fileOk') + file.name;
          label.classList.remove('is-error');
        }
        if (zone) zone.classList.add('has-file');
        // Reveal the paste area so the user can see exactly what was loaded.
        var det = target.closest ? target.closest('details') : null;
        if (det) det.open = true;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      };
      reader.onerror = function () {
        if (label) {
          label.textContent = T('trn.invalidJson') + file.name;
          label.classList.add('is-error');
        }
      };
      reader.readAsText(file);
    }

    input.addEventListener('change', function (e) {
      load(e.target.files && e.target.files[0]);
    });
    if (!zone) return;

    zone.addEventListener('click', function (e) {
      if (e.target !== input && !input.contains(e.target)) input.click();
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
    });
    zone.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) load(files[0]);
    });
  }

  Array.prototype.forEach.call(
    document.querySelectorAll('input[type="file"][data-json-target]'), bindDropzone);

  /* ── 2. Guide toggle ─────────────────────────────────────── */
  Array.prototype.forEach.call(document.querySelectorAll('[data-open-guide]'), function (btn) {
    btn.addEventListener('click', function () {
      var g = $('jsonGuide');
      if (!g) return;
      g.open = true;
      if (typeof g.scrollIntoView === 'function') {
        g.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  /* ── 3. Landing hero: run a free check in place ───────────── */
  var root = $('freeCheck');
  if (!root) return;
  var tab = 'url';

  function status(html, cls) {
    $('fcStatus').innerHTML = html
      ? '<div class="notice ' + (cls || 'info') + ' fc-status">' + html + '</div>'
      : '';
  }
  function fail(msg) { status('✕ ' + esc(msg), 'error'); }

  function setTab(next) {
    tab = next;
    $('fcTabUrl').classList.toggle('active', tab === 'url');
    $('fcTabJson').classList.toggle('active', tab === 'json');
    $('fcPaneUrl').classList.toggle('hidden', tab !== 'url');
    $('fcPaneJson').classList.toggle('hidden', tab !== 'json');
    $('fcRun').textContent = (tab === 'url' ? T('free.runUrl') : T('free.runJson')) + ' →';
    status('');
  }
  $('fcTabUrl').addEventListener('click', function () { setTab('url'); });
  $('fcTabJson').addEventListener('click', function () { setTab('json'); });

  function submit(endpoint, body, waiting) {
    $('fcRun').disabled = true;
    status('<span class="spinner"></span> ' + esc(waiting) +
      '<div class="progress-line mt-2"><i></i></div>', 'info');
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        $('fcRun').disabled = false;
        if (!r.ok) {
          if (r.d.needsTargetUrl) {
            status('⚠ ' + esc(r.d.error) + '<br /><br /><b>' + esc(T('ck.nextStep')) + '</b> ' +
              '<a href="/checker">' + esc(T('free.advanced')) + ' →</a> ' +
              esc(T('free.nextStepHint')), 'warn');
            return;
          }
          return fail(r.d.error || T('ck.failed'));
        }
        status('✓ ' + esc(T('ck.done')), 'ok');
        setTimeout(function () { window.location.href = '/report/' + r.d.id; }, 600);
      })
      .catch(function (e) {
        $('fcRun').disabled = false;
        fail(T('ck.netErr') + e.message);
      });
  }

  $('fcRun').addEventListener('click', function () {
    var srcLang = $('fcSrcLang').value;
    var tgtLang = $('fcTgtLang').value;
    if (srcLang === tgtLang) return fail(T('ck.langSame'));

    if (tab === 'url') {
      var url = $('fcUrl').value.trim();
      if (!url) { $('fcUrl').focus(); return fail(T('ck.needUrl')); }
      return submit('/api/audit', {
        websiteUrl: url, sourceLanguage: srcLang, targetLanguage: tgtLang
      }, T('ck.scanning'));
    }

    var rawSrc = $('fcJson').value.trim();
    if (!rawSrc) return fail(T('free.needJson'));
    var src;
    try { src = JSON.parse(rawSrc); }
    catch (e) { return fail(T('ck.srcInvalid') + e.message); }
    if (!src || typeof src !== 'object' || Array.isArray(src)) {
      return fail(T('ck.srcInvalid') + T('free.rootObject'));
    }

    var rawTgt = $('fcJsonTarget').value.trim();
    var tgt = null;
    if (rawTgt) {
      try { tgt = JSON.parse(rawTgt); }
      catch (e) { return fail(T('ck.tgtInvalid') + e.message); }
      if (!tgt || typeof tgt !== 'object' || Array.isArray(tgt)) {
        return fail(T('ck.tgtInvalid') + T('free.tgtRootObject'));
      }
    }
    submit('/api/audit/json', {
      sourceJson: src, targetJson: tgt,
      sourceLanguage: srcLang, targetLanguage: tgtLang
    }, T('ck.auditing'));
  });

  setTab('url');
})();
