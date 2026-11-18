/* Admin configuration console — translation model API + scoring rules + quotas. */
(function () {
  'use strict';
  var T = window.T || function (k) { return k; };
  var root = document.getElementById('cfgRoot');
  var statusEl = document.getElementById('cfgStatus');
  var tokenEl = document.getElementById('cfgToken');
  var loadBtn = document.getElementById('cfgLoad');
  var state = null, meta = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function token() {
    var t = (tokenEl.value || '').trim();
    if (t) { try { sessionStorage.setItem('l10n_admin_token', t); } catch (e) {} }
    return t || (function () { try { return sessionStorage.getItem('l10n_admin_token') || ''; } catch (e) { return ''; } })();
  }
  function setStatus(msg, kind) {
    statusEl.innerHTML = '<div class="notice ' + (kind || 'info') + '">' + esc(msg) + '</div>';
  }
  async function api(path, opts) {
    opts = opts || {};
    var res = await fetch(path, {
      method: opts.method || 'GET',
      headers: Object.assign({
        'content-type': 'application/json',
        'x-admin-token': token()
      }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }
  function field(id, label, value, type, hint) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value) + '" />' +
      (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function numField(id, label, value, step, hint) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="number" step="' + step + '" value="' + esc(value) + '" />' +
      (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function v(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function n(id) { var x = Number(v(id)); return Number.isFinite(x) ? x : 0; }
  function dimLabel(k) { return T('dim.' + k) || k; }
  function typeLabel(t) { return T('type.' + t) || t; }

  function render() {
    var ai = state.ai, sc = state.scoring, q = state.quota;
    var dimKeys = Object.keys(sc.dimensions);
    var sevKeys = Object.keys(sc.severityWeight);
    var modelKeys = Object.keys(sc.model);
    var issueKeys = Object.keys(sc.issueDimension);

    var dimRows = dimKeys.map(function (k) {
      return '<div class="cfg-line"><label for="w_' + k + '">' + esc(dimLabel(k)) + '</label>' +
        '<input id="w_' + k + '" type="number" step="1" min="0" value="' +
        esc(String(Math.round(sc.dimensions[k].weight * 100))) + '" /></div>';
    }).join('');
    var sevRows = sevKeys.map(function (k) {
      return '<div class="cfg-line"><label for="s_' + k + '">' + esc(T('sev.' + k) || k) + '</label>' +
        '<input id="s_' + k + '" type="number" step="0.05" min="0" value="' + esc(String(sc.severityWeight[k])) + '" /></div>';
    }).join('');
    var modelRows = modelKeys.map(function (k) {
      var labels = { rateFactor: 'cfg.rateFactor', countUnit: 'cfg.countUnit', absoluteCap: 'cfg.absoluteCap' };
      return '<div class="cfg-line"><label for="m_' + k + '">' + esc(T(labels[k]) || k) + '</label>' +
        '<input id="m_' + k + '" type="number" step="0.1" min="0" value="' + esc(String(sc.model[k])) + '" /></div>';
    }).join('');
    var mapRows = issueKeys.map(function (t) {
      var opts = dimKeys.map(function (k) {
        return '<option value="' + k + '"' + (sc.issueDimension[t] === k ? ' selected' : '') + '>' + esc(dimLabel(k)) + '</option>';
      }).join('');
      return '<div class="cfg-line"><label for="i_' + t + '">' + esc(typeLabel(t)) + '</label>' +
        '<select id="i_' + t + '">' + opts + '</select></div>';
    }).join('');

    root.innerHTML =
      '<div class="cfg-grid">' +
      // ── AI ──
      '<section class="form-panel paper"><div class="nt-title">' + esc(T('cfg.aiTitle')) + '</div>' +
      '<div class="small muted mb-2">' + esc(T('cfg.aiDesc')) + '</div>' +
      '<div class="field"><label for="ai_provider">' + esc(T('cfg.provider')) + '</label><select id="ai_provider">' +
      '<option value="mock"' + (ai.provider === 'mock' ? ' selected' : '') + '>' + esc(T('cfg.providerMock')) + '</option>' +
      '<option value="openai"' + (ai.provider === 'openai' ? ' selected' : '') + '>' + esc(T('cfg.providerOpenai')) + '</option>' +
      '</select></div>' +
      field('ai_baseUrl', T('cfg.baseUrl'), ai.baseUrl) +
      field('ai_model', T('cfg.model'), ai.model) +
      '<div class="field"><label for="ai_apiKey">' + esc(T('cfg.apiKey')) + '</label>' +
      '<input id="ai_apiKey" type="password" value="" placeholder="' +
      esc(ai.apiKeySet ? T('cfg.apiKeySet') + ' (' + ai.apiKeyHint + ')' : T('cfg.apiKeyUnset')) + '" autocomplete="new-password" />' +
      '<div class="hint">' + esc(T('cfg.aiDesc')) + '</div></div>' +
      '<div class="field-row cols-3">' +
      numField('ai_temperature', T('cfg.temperature'), ai.temperature, '0.1') +
      numField('ai_timeoutMs', T('cfg.timeout'), ai.timeoutMs, '1000') +
      numField('ai_maxRetries', T('cfg.retries'), ai.maxRetries, '1') +
      '</div>' +
      '<button class="btn sm" id="cfgTest" type="button">' + esc(T('cfg.testAi')) + '</button>' +
      '<span id="cfgTestResult" class="small muted" style="margin-left:10px"></span>' +
      '</section>' +

      // ── Scoring ──
      '<section class="form-panel paper"><div class="nt-title">' + esc(T('cfg.scoreTitle')) + '</div>' +
      '<div class="small muted mb-2">' + esc(T('cfg.scoreDesc')) + '</div>' +
      '<div class="cell-label">' + esc(T('cfg.dimWeight')) + '</div>' + dimRows +
      '<div class="hint">' + esc(T('cfg.weightNote')) + '</div>' +
      '<div class="cell-label mt-3">' + esc(T('cfg.severityTitle')) + '</div>' + sevRows +
      '<div class="cell-label mt-3">' + esc(T('cfg.modelTitle')) + '</div>' + modelRows +
      '<details class="mt-3"><summary class="small">' + esc(T('cfg.issueMap')) + '</summary>' + mapRows + '</details>' +
      '<div class="mt-3"><button class="btn sm" id="cfgPreview" type="button">' + esc(T('cfg.preview')) + '</button>' +
      '<div id="cfgPreviewResult" class="notice info mt-2" style="display:none"></div></div>' +
      '</section>' +

      // ── Quota ──
      '<section class="form-panel paper"><div class="nt-title">' + esc(T('cfg.quotaTitle')) + '</div>' +
      '<div class="small muted mb-2">' + esc(T('cfg.quotaDesc')) + '</div>' +
      numField('q_anon', T('cfg.anonDaily'), q.anonAuditDaily, '1') +
      numField('q_user', T('cfg.userMonthly'), q.userAuditMonthly, '1') +
      numField('q_examples', T('cfg.freeExamples'), q.freeReportFullExamples, '1') +
      '<div class="hint">' + esc(T('cfg.zeroNote')) + '</div>' +
      '</section>' +
      '</div>' +

      '<div class="mt-3" style="display:flex;gap:12px;flex-wrap:wrap">' +
      '<button class="btn primary" id="cfgSave" type="button">' + esc(T('cfg.saveAll')) + '</button>' +
      '<button class="btn ghost" id="cfgReset" type="button">' + esc(T('cfg.resetAll')) + '</button>' +
      '</div>';

    document.getElementById('cfgSave').addEventListener('click', save);
    document.getElementById('cfgReset').addEventListener('click', reset);
    document.getElementById('cfgTest').addEventListener('click', testAi);
    document.getElementById('cfgPreview').addEventListener('click', preview);
  }

  function collect() {
    var sc = state.scoring;
    var dimensions = {};
    Object.keys(sc.dimensions).forEach(function (k) {
      dimensions[k] = { weight: n('w_' + k) / 100, label: sc.dimensions[k].label };
    });
    var severityWeight = {};
    Object.keys(sc.severityWeight).forEach(function (k) { severityWeight[k] = n('s_' + k); });
    var model = {};
    Object.keys(sc.model).forEach(function (k) { model[k] = n('m_' + k); });
    var issueDimension = {};
    Object.keys(sc.issueDimension).forEach(function (t) {
      issueDimension[t] = v('i_' + t) || sc.issueDimension[t];
    });
    var patch = {
      ai: {
        provider: v('ai_provider'), baseUrl: v('ai_baseUrl'), model: v('ai_model'),
        apiKey: v('ai_apiKey'), temperature: n('ai_temperature'),
        timeoutMs: n('ai_timeoutMs'), maxRetries: n('ai_maxRetries')
      },
      scoring: { dimensions: dimensions, severityWeight: severityWeight, model: model, issueDimension: issueDimension },
      quota: {
        anonAuditDaily: n('q_anon'), userAuditMonthly: n('q_user'),
        freeReportFullExamples: n('q_examples')
      }
    };
    return patch;
  }

  async function load() {
    setStatus(T('cfg.loading'), 'info');
    try {
      meta = await api('/api/admin/settings/meta');
      var res = await api('/api/admin/settings');
      state = res;
      root.innerHTML = '';
      render();
      // neutral status after load
      statusEl.innerHTML = '<div class="notice ok">' + esc(T('cfg.load') + ' ✓') + '</div>';
    } catch (e) {
      root.innerHTML = '';
      setStatus(e.message, 'error');
    }
  }
  async function save() {
    setStatus(T('cfg.loading'), 'info');
    try {
      var res = await api('/api/admin/settings', { method: 'PUT', body: collect() });
      state = res.settings;
      render();
      setStatus(T('cfg.saved'), 'ok');
    } catch (e) { setStatus(T('cfg.saveFailed') + ': ' + e.message, 'error'); }
  }
  async function reset() {
    if (!confirm(T('cfg.resetConfirm'))) return;
    try {
      var res = await api('/api/admin/settings/reset', { method: 'POST', body: {} });
      state = res.settings;
      render();
      setStatus(T('cfg.resetDone'), 'ok');
    } catch (e) { setStatus(e.message, 'error'); }
  }
  async function testAi() {
    var el = document.getElementById('cfgTestResult');
    el.textContent = T('cfg.testing');
    try {
      var r = await api('/api/admin/settings/test-ai', { method: 'POST', body: {} });
      el.textContent = r.ok
        ? 'OK · ' + r.provider + ' / ' + r.model + (r.mock ? ' (mock)' : '') + ' · ' + r.latencyMs + 'ms'
        : 'FAIL · ' + (r.error || 'unknown');
    } catch (e) { el.textContent = 'FAIL · ' + e.message; }
  }
  async function preview() {
    var box = document.getElementById('cfgPreviewResult');
    try {
      var r = await api('/api/admin/settings/preview', { method: 'POST', body: { scoring: collect().scoring } });
      var lines = Object.keys(r.dimensions).map(function (k) {
        return esc(dimLabel(k)) + ' ' + r.dimensions[k].score;
      }).join(' · ');
      box.innerHTML = '<b>' + esc(T('cfg.previewLabel')) + ': ' + r.overall + '</b> / 100<br>' +
        '<span class="small muted">' + esc(T('cfg.previewSample')) + '</span><br>' + lines;
      box.style.display = 'block';
    } catch (e) { box.innerHTML = esc(e.message); box.style.display = 'block'; }
  }

  // Fill the token from session memory if available.
  try { tokenEl.value = sessionStorage.getItem('l10n_admin_token') || ''; } catch (e) {}
  loadBtn.addEventListener('click', load);
})();
