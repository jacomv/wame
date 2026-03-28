// ── State ───────────────────────────────────────────────────────
let _apiKey       = null;
let pollTimer     = null;
let qrStore       = {};
let webhookStore  = {};
let instancesData = [];
let activeView    = 'instances';
let detailName    = null;

// ── API helper ──────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'x-api-key': _apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { doLogout(); throw new Error(t('toast.session.expired')); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Auth ────────────────────────────────────────────────────────
let _activeTab = 'apikey';

function switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.login-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  document.getElementById('login-error').textContent = '';

  const btn = document.getElementById('login-btn');
  if (tab === 'register') {
    btn.textContent = t('login.btn.register');
  } else {
    btn.textContent = t('login.btn');
  }
}

async function enterApp(apiKey) {
  _apiKey = apiKey;
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  applyTranslations();
  startPolling();
}

async function doLogin() {
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  btn.disabled = true;
  err.textContent = '';

  try {
    if (_activeTab === 'apikey') {
      const key = document.getElementById('login-input').value.trim();
      if (!key) { err.textContent = t('login.error.invalid'); btn.disabled = false; return; }

      const res = await fetch('/status', { headers: { 'x-api-key': key } });
      if (res.status === 401) { err.textContent = t('login.error.invalid'); btn.disabled = false; return; }
      if (res.status === 429) { err.textContent = t('login.error.rate_limit'); btn.disabled = false; return; }
      if (!res.ok) { err.textContent = t('login.error.server'); btn.disabled = false; return; }
      document.getElementById('login-input').value = '';
      await enterApp(key);

    } else if (_activeTab === 'email') {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) { err.textContent = t('login.error.fields'); btn.disabled = false; return; }

      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { err.textContent = data.error; btn.disabled = false; return; }
      document.getElementById('login-email').value = '';
      document.getElementById('login-password').value = '';
      await enterApp(data.apiKey);

    } else if (_activeTab === 'register') {
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      if (!email || !password) { err.textContent = t('login.error.fields'); btn.disabled = false; return; }
      if (password.length < 6) { err.textContent = t('login.error.password_short'); btn.disabled = false; return; }

      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { err.textContent = data.error; btn.disabled = false; return; }
      document.getElementById('reg-email').value = '';
      document.getElementById('reg-password').value = '';
      await enterApp(data.apiKey);
    }
  } catch (e) {
    err.textContent = t('login.error.connect') + e.message;
  }
  btn.disabled = false;
}

function doLogout() {
  _apiKey = null;
  stopPolling();
  instancesData = []; qrStore = {}; webhookStore = {};
  detailName = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-input').value = '';
  document.getElementById('login-error').textContent = '';
  showView('instances');
}

// ── Views ───────────────────────────────────────────────────────
function showView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view)?.classList.add('active');

  const navTarget = view === 'detail' ? 'instances' : view;
  document.querySelectorAll('.nav-item[data-view]').forEach(n => {
    n.classList.toggle('active', n.dataset.view === navTarget);
  });
}

// ── Polling ─────────────────────────────────────────────────────
function startPolling() { stopPolling(); poll(); pollTimer = setInterval(poll, 3000); }
function stopPolling()  { clearInterval(pollTimer); pollTimer = null; }

async function poll() {
  try {
    const data = await api('GET', '/status');
    instancesData = data.instances || [];
    renderInstancesGrid(instancesData);
    await fetchAllWebhooks(instancesData);
    if (activeView === 'detail' && detailName) refreshDetailDynamic(detailName);
    fetchLogs();
  } catch (_) {}
}

// ── Instances grid ──────────────────────────────────────────────
function renderInstancesGrid(instances) {
  const grid = document.getElementById('instances-grid');

  if (!instances.length) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📱</div>
      <p>${t('instances.empty')}</p>
    </div>`;
    return;
  }

  const names = new Set(instances.map(i => i.name));
  grid.querySelectorAll('.instance-card').forEach(el => {
    if (!names.has(el.dataset.name)) el.remove();
  });
  grid.querySelector('.empty-state')?.remove();

  instances.forEach(inst => {
    const existing = grid.querySelector(`[data-name="${CSS.escape(inst.name)}"]`);
    if (existing) {
      updateCard(existing, inst);
    } else {
      const el = document.createElement('div');
      el.innerHTML = buildCard(inst, true);
      grid.appendChild(el.firstElementChild);
    }
  });
}

function buildCard(inst, isNew) {
  const qr = inst.status === 'qr' && qrStore[inst.name];
  return `<div class="instance-card${isNew ? ' new-card' : ''}" data-name="${escHtml(inst.name)}">
    <div class="card-top">
      <div>
        <div class="card-name">${escHtml(inst.name)}</div>
        <div class="card-phone">${inst.phone ? '+' + inst.phone : '—'}</div>
      </div>
      <span class="status-badge ${inst.status}">${t('status.' + inst.status) || inst.status}</span>
    </div>
    ${qr ? buildQrBlock(inst.name) : ''}
    <div class="card-meta">
      ${t('instances.connected')} <span>${inst.connectedAt ? fmtDate(inst.connectedAt) : '—'}</span>
    </div>
    <div class="card-footer">
      <button class="btn btn-secondary" style="font-size:0.8rem" data-action="open-detail" data-name="${escHtml(inst.name)}">
        ${t('instances.view_detail')}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  </div>`;
}

function updateCard(el, inst) {
  el.querySelector('.status-badge').className = `status-badge ${inst.status}`;
  el.querySelector('.status-badge').textContent = t('status.' + inst.status) || inst.status;
  el.querySelector('.card-phone').textContent = inst.phone ? '+' + inst.phone : '—';
  const meta = el.querySelector('.card-meta');
  if (meta) meta.innerHTML = `${t('instances.connected')} <span>${inst.connectedAt ? fmtDate(inst.connectedAt) : '—'}</span>`;

  const existingQr = el.querySelector('.qr-wrap');
  if (inst.status === 'qr' && qrStore[inst.name]) {
    if (!existingQr) {
      const div = document.createElement('div');
      div.innerHTML = buildQrBlock(inst.name);
      el.querySelector('.card-top').insertAdjacentElement('afterend', div.firstElementChild);
    }
  } else if (existingQr) {
    existingQr.remove();
  }
}

function buildQrBlock(name) {
  return `<div class="qr-wrap">
    <div class="qr-label">${t('qr.label')}</div>
    <img src="${qrStore[name]}" alt="QR ${escHtml(name)}">
    <div class="qr-hint">${t('qr.hint')}</div>
  </div>`;
}

// ── Instance detail ──────────────────────────────────────────────
function openDetail(name) {
  detailName = name;
  showView('detail');
  renderDetail(name);
}

function renderDetail(name) {
  const inst = instancesData.find(i => i.name === name);
  if (!inst) { showView('instances'); return; }

  document.getElementById('detail-title').textContent = name;
  document.getElementById('detail-badge').innerHTML =
    `<span class="status-badge ${inst.status}">${t('status.' + inst.status) || inst.status}</span>`;

  renderDetailActions(inst);
  renderDetailContent(inst);
}

function refreshDetailDynamic(name) {
  const inst = instancesData.find(i => i.name === name);
  if (!inst) return;

  const badge = document.getElementById('detail-badge');
  if (badge) badge.innerHTML = `<span class="status-badge ${inst.status}">${t('status.' + inst.status) || inst.status}</span>`;

  renderDetailActions(inst);

  const qrEl = document.getElementById('detail-qr-section');
  if (qrEl) qrEl.innerHTML = (inst.status === 'qr' && qrStore[name]) ? buildQrBlock(name) : '';

  const whEl = document.getElementById('detail-webhooks-list');
  if (whEl) whEl.innerHTML = buildWebhooksList(name);
}

function renderDetailActions(inst) {
  const bar = document.getElementById('detail-actions');
  if (inst.status === 'connected') {
    bar.innerHTML = `
      <button class="btn btn-secondary" data-action="restart" data-name="${escHtml(inst.name)}">${t('detail.restart')}</button>
      <button class="btn btn-danger" data-action="disconnect" data-name="${escHtml(inst.name)}">${t('detail.disconnect')}</button>`;
  } else {
    bar.innerHTML = `
      <button class="btn btn-secondary" data-action="reconnect" data-name="${escHtml(inst.name)}">${t('detail.reconnect')}</button>
      <button class="btn btn-danger" data-action="disconnect" data-name="${escHtml(inst.name)}">${t('detail.delete')}</button>`;
  }
}

function renderDetailContent(inst) {
  const hasQr = inst.status === 'qr' && qrStore[inst.name];
  document.getElementById('detail-content').innerHTML = `
    <div class="detail-grid">
      ${hasQr ? `<div id="detail-qr-section">${buildQrBlock(inst.name)}</div>` : '<div id="detail-qr-section" style="display:none"></div>'}

      <div class="detail-card"${!hasQr ? ' style="grid-column:1/-1;max-width:480px"' : ''}>
        <div class="detail-card-title">${t('detail.info')}</div>
        <div class="info-row">
          <span class="info-row-label">${t('detail.status')}</span>
          <span class="info-row-value">${inst.status}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">${t('detail.number')}</span>
          <span class="info-row-value">${inst.phone ? '+' + inst.phone : '—'}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">${t('detail.connected_since')}</span>
          <span class="info-row-value">${inst.connectedAt ? fmtDate(inst.connectedAt) : '—'}</span>
        </div>
      </div>

      <div class="detail-card" style="grid-column:1/-1">
        <div class="detail-card-title" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
          <span>${t('detail.webhooks')}</span>
          <button class="btn btn-primary" style="font-size:0.8rem" data-action="add-hook" data-name="${escHtml(inst.name)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${t('detail.webhooks.add')}
          </button>
        </div>
        <div id="detail-webhooks-list">${buildWebhooksList(inst.name)}</div>
      </div>
    </div>`;
}

function buildWebhooksList(name) {
  const hooks = webhookStore[name] || [];
  if (!hooks.length) return `<div class="webhook-empty">${t('detail.webhooks.empty')}</div>`;
  return `<div class="webhook-list">${hooks.map(h => `
    <div class="webhook-row">
      <span class="webhook-row-url" title="${escHtml(h.url)}">${escHtml(h.url)}</span>
      <div class="webhook-row-events">${h.events.map(e => `<span class="event-tag">${e}</span>`).join('')}</div>
      <button class="webhook-row-edit" data-action="edit-hook" data-name="${escHtml(name)}" data-hook-id="${h.id}" title="Edit">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="webhook-row-del" data-action="del-hook" data-name="${escHtml(name)}" data-hook-id="${h.id}" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
    </div>`).join('')}
  </div>`;
}

// ── Webhooks CRUD ───────────────────────────────────────────────
async function fetchWebhooks(name) {
  try {
    const data = await api('GET', `/instances/${name}/webhooks`);
    webhookStore[name] = data.webhooks || [];
  } catch (_) { webhookStore[name] = []; }
}

async function fetchAllWebhooks(instances) {
  for (const inst of instances) {
    if (inst.status === 'connected') fetchWebhooks(inst.name);
  }
}

function openWebhookModal(name, hook = null) {
  document.getElementById('webhook-instance').value = name;
  document.getElementById('webhook-edit-id').value = hook ? hook.id : '';
  document.getElementById('webhook-url-input').value = hook ? hook.url : '';
  document.querySelectorAll('#modal-webhook .checks-group input').forEach(cb => {
    cb.checked = hook ? hook.events.includes(cb.value) : cb.value === 'messages';
  });
  document.querySelector('#modal-webhook .modal-title').textContent =
    hook ? t('modal.wh.title.edit') : t('modal.wh.title');
  document.getElementById('modal-webhook').classList.remove('hidden');
  setTimeout(() => document.getElementById('webhook-url-input').focus(), 50);
}

function closeWebhookModal() { document.getElementById('modal-webhook').classList.add('hidden'); }

async function createWebhook() {
  const name   = document.getElementById('webhook-instance').value;
  const editId = document.getElementById('webhook-edit-id').value;
  const url    = document.getElementById('webhook-url-input').value.trim();
  const events = Array.from(document.querySelectorAll('#modal-webhook .checks-group input:checked')).map(cb => cb.value);

  if (!url)          { toast('err', t('val.enter_url'));    return; }
  if (!events.length){ toast('err', t('val.select_event')); return; }

  closeWebhookModal();
  try {
    if (editId) {
      await api('PUT', `/instances/${name}/webhooks/${editId}`, { url, events });
      toast('ok', t('toast.webhook.updated'));
    } else {
      await api('POST', `/instances/${name}/webhooks`, { url, events });
      toast('ok', t('toast.webhook.added'));
    }
    await fetchWebhooks(name);
    const el = document.getElementById('detail-webhooks-list');
    if (el) el.innerHTML = buildWebhooksList(name);
  } catch (e) { toast('err', e.message); }
}

async function deleteWebhook(name, hookId) {
  if (!confirm(t('confirm.webhook.delete'))) return;
  try {
    await api('DELETE', `/instances/${name}/webhooks/${hookId}`);
    toast('ok', t('toast.webhook.deleted'));
    await fetchWebhooks(name);
    const el = document.getElementById('detail-webhooks-list');
    if (el) el.innerHTML = buildWebhooksList(name);
  } catch (e) { toast('err', e.message); }
}

// ── Instance actions ────────────────────────────────────────────
async function reconnectInstance(name) {
  toast('info', `${name}…`);
  try {
    const data = await api('POST', `/instances/${name}/connect`);
    if (data.status === 'qr') { qrStore[name] = data.qr; toast('info', t('toast.qr.ready')); }
    else toast('ok', `${name} ${t('val.already_connected')}`);
    poll();
  } catch (e) { toast('err', e.message); }
}

async function restartInstance(name) {
  toast('info', `${name}…`);
  try {
    const data = await api('POST', `/instances/${name}/restart`);
    if (data.status === 'qr') { qrStore[name] = data.qr; toast('info', t('toast.qr.ready')); }
    else toast('ok', `${name} — restarted`);
    poll();
  } catch (e) { toast('err', e.message); }
}

async function disconnectInstance(name) {
  if (!confirm(`${t('confirm.disconnect')} "${name}"?`)) return;
  try {
    await api('DELETE', `/instances/${name}`);
    delete qrStore[name]; delete webhookStore[name];
    instancesData = instancesData.filter(i => i.name !== name);
    toast('ok', `${name} — ${t('toast.instance.deleted')}`);
    if (activeView === 'detail') showView('instances');
    renderInstancesGrid(instancesData);
  } catch (e) { toast('err', e.message); }
}

// ── New instance modal ──────────────────────────────────────────
function openNewModal() {
  document.getElementById('modal-new').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-name-input').focus(), 50);
}
function closeNewModal() {
  document.getElementById('modal-new').classList.add('hidden');
  document.getElementById('new-name-input').value = '';
}

async function createInstance() {
  const name = document.getElementById('new-name-input').value.trim();
  if (!name)                       { toast('err', t('val.enter_name'));    return; }
  if (!/^[a-z0-9_-]+$/i.test(name)){ toast('err', t('val.invalid_name')); return; }
  closeNewModal();
  toast('info', `${name}…`);
  try {
    const data = await api('POST', `/instances/${name}/connect`);
    if (data.status === 'qr') { qrStore[name] = data.qr; toast('info', t('toast.qr.ready')); }
    else if (data.status === 'connected') toast('ok', `"${name}" ${t('val.already_connected')}`);
    poll();
  } catch (e) { toast('err', e.message); }
}

// ── Logs ────────────────────────────────────────────────────────
async function fetchLogs() {
  try {
    const data = await api('GET', '/logs?limit=20');
    const tbody = document.getElementById('logs-body');
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="no-rows">${t('logs.empty')}</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(log => {
      const dest    = log.to.length > 32 ? log.to.slice(0, 30) + '…' : log.to;
      const errTip  = log.error ? ` title="${escHtml(log.error)}"` : '';
      return `<tr>
        <td class="td-instance">${escHtml(log.instance)}</td>
        <td class="td-mono">${escHtml(dest)}</td>
        <td class="td-type ${log.type}">${log.type}</td>
        <td class="${log.status === 'ok' ? 'td-ok' : 'td-err'}"${errTip}>${log.status === 'ok' ? '✓ OK' : '✗ Error'}</td>
        <td class="td-mono" style="color:var(--text-3)">${fmtDate(log.created_at)}</td>
      </tr>`;
    }).join('');
  } catch (_) {}
}

// ── Toast ────────────────────────────────────────────────────────
let toastTimer;
function toast(type, msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'hidden', 4000);
}

// ── Helpers ─────────────────────────────────────────────────────
function fmtDate(iso) {
  return new Date(iso).toLocaleString(getLang() === 'es' ? 'es-CO' : 'en-US', { hour12: false, dateStyle: 'short', timeStyle: 'short' });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Event listeners ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Apply saved language on load
  applyTranslations();
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === getLang());
  });

  // Language toggle
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  // Mobile sidebar
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }
  document.getElementById('btn-hamburger').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
  });
  overlay.addEventListener('click', closeSidebar);

  // Login tabs
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Login
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('reg-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // Sidebar nav
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view === 'logs') fetchLogs();
      showView(btn.dataset.view);
      closeSidebar();
    });
  });

  // New instance
  document.getElementById('btn-new-instance').addEventListener('click', openNewModal);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeNewModal);
  document.getElementById('btn-modal-create').addEventListener('click', createInstance);
  document.getElementById('new-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') createInstance(); });
  document.getElementById('modal-new').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-new')) closeNewModal();
  });

  // Webhook modal
  document.getElementById('btn-hook-cancel').addEventListener('click', closeWebhookModal);
  document.getElementById('btn-hook-create').addEventListener('click', createWebhook);
  document.getElementById('webhook-url-input').addEventListener('keydown', e => { if (e.key === 'Enter') createWebhook(); });
  document.getElementById('modal-webhook').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-webhook')) closeWebhookModal();
  });

  // Back
  document.getElementById('btn-back').addEventListener('click', () => showView('instances'));

  // Refresh logs
  document.getElementById('btn-refresh-logs').addEventListener('click', fetchLogs);

  // Delegated clicks
  document.getElementById('main').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, name, hookId } = btn.dataset;
    if      (action === 'open-detail')  openDetail(name);
    else if (action === 'reconnect')    reconnectInstance(name);
    else if (action === 'restart')      restartInstance(name);
    else if (action === 'disconnect')   disconnectInstance(name);
    else if (action === 'add-hook')     openWebhookModal(name);
    else if (action === 'edit-hook')    openWebhookModal(name, (webhookStore[name] || []).find(h => h.id === hookId));
    else if (action === 'del-hook')     deleteWebhook(name, hookId);
  });
});
