// ── API key solo en memoria — nunca en DOM ni localStorage ─────
let _apiKey = null;
let pollTimer = null;
let qrStore = {};
let webhookStore = {}; // name → [ { id, url, events } ]
const existingCards = new Set();

// ── Login ──────────────────────────────────────────────────────
async function doLogin() {
  const input = document.getElementById('login-input');
  const btn   = document.getElementById('login-btn');
  const err   = document.getElementById('login-error');
  const key   = input.value.trim();

  if (!key) { err.textContent = 'Ingresa la API key'; return; }

  btn.disabled = true;
  btn.textContent = 'VERIFICANDO…';
  err.textContent = '';

  try {
    const res = await fetch('/status', { headers: { 'x-api-key': key } });

    if (res.status === 401) {
      err.textContent = '✗ API key incorrecta';
      btn.disabled = false;
      btn.textContent = 'ACCEDER →';
      input.focus();
      return;
    }

    if (res.status === 429) {
      err.textContent = '✗ Demasiados intentos. Espera un momento.';
      btn.disabled = false;
      btn.textContent = 'ACCEDER →';
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      err.textContent = '✗ Error del servidor: ' + (body.error || 'HTTP ' + res.status);
      btn.disabled = false;
      btn.textContent = 'ACCEDER →';
      return;
    }

    _apiKey = key;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    input.value = '';
    startPolling();
    updateClock();
    setInterval(updateClock, 1000);
  } catch (e) {
    err.textContent = '✗ No se pudo conectar al servidor: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'ACCEDER →';
    input.focus();
  }
}

function doLogout() {
  _apiKey = null;
  stopPolling();
  existingCards.clear();
  qrStore = {};
  webhookStore = {};
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-input').value = '';
  document.getElementById('login-error').textContent = '';
}

// ── Clock ──────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('es-CO', { hour12: false });
  document.getElementById('date-display').textContent = now.toLocaleDateString('es-CO', { weekday:'short', year:'numeric', month:'short', day:'numeric' }).toUpperCase();
}

// ── API helper ─────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'x-api-key': _apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { doLogout(); throw new Error('sesión expirada'); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Polling ────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  poll();
  pollTimer = setInterval(poll, 3000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function poll() {
  try {
    const data = await api('GET', '/status');
    updateInstances(data.instances || []);
    fetchAllWebhooks(data.instances || []);
    fetchLogs();
  } catch (_) {}
}

// ── Update instancias SIN reescribir el DOM completo ───────────
function updateInstances(instances) {
  const grid = document.getElementById('instances-grid');

  if (!instances.length) {
    grid.innerHTML = '<div class="empty-state"><span class="big">[∅]</span>no hay instancias activas — crea una nueva</div>';
    existingCards.clear();
    qrStore = {};
    return;
  }

  instances.forEach(inst => {
    if (inst.status === 'connected') delete qrStore[inst.name];
  });

  const currentNames = new Set(instances.map(i => i.name));

  existingCards.forEach(name => {
    if (!currentNames.has(name)) {
      document.getElementById('card-' + name)?.remove();
      existingCards.delete(name);
    }
  });

  grid.querySelector('.empty-state')?.remove();

  instances.forEach(inst => {
    const existing = document.getElementById('card-' + inst.name);
    if (existing) {
      updateCard(existing, inst);
    } else {
      const div = document.createElement('div');
      div.innerHTML = buildCardHTML(inst, true);
      grid.appendChild(div.firstElementChild);
      existingCards.add(inst.name);
    }
  });
}

function updateCard(el, inst) {
  el.className = 'instance-card ' + inst.status;

  const badge = el.querySelector('.badge');
  if (badge) {
    badge.className = 'badge ' + inst.status;
    badge.textContent = statusLabel(inst.status);
  }

  const phone = el.querySelector('.instance-phone');
  if (phone) phone.textContent = inst.phone ? '📱 ' + inst.phone : 'sin número';

  const meta = el.querySelector('.card-meta');
  if (meta) meta.innerHTML = buildMeta(inst);

  const existingQr = el.querySelector('.qr-wrap');
  if (inst.status === 'qr' && qrStore[inst.name]) {
    if (!existingQr) {
      const div = document.createElement('div');
      div.innerHTML = buildQrHTML(inst.name);
      el.querySelector('.card-meta')?.insertAdjacentElement('beforebegin', div.firstElementChild);
    }
  } else if (existingQr) {
    existingQr.remove();
  }

  const hooksEl = el.querySelector('.webhooks-section');
  if (hooksEl) hooksEl.innerHTML = buildWebhooksHTML(inst.name);

  const actions = el.querySelector('.card-actions');
  if (actions) actions.innerHTML = buildActions(inst);
}

function buildCardHTML(inst, isNew) {
  return '<div class="instance-card ' + inst.status + (isNew ? ' new-card' : '') + '" id="card-' + inst.name + '">' +
    '<div class="card-header"><div>' +
    '<div class="instance-name">' + escHtml(inst.name) + '</div>' +
    '<div class="instance-phone">' + (inst.phone ? '📱 ' + inst.phone : 'sin número') + '</div>' +
    '</div><span class="badge ' + inst.status + '">' + statusLabel(inst.status) + '</span></div>' +
    (inst.status === 'qr' && qrStore[inst.name] ? buildQrHTML(inst.name) : '') +
    '<div class="card-meta">' + buildMeta(inst) + '</div>' +
    '<div class="webhooks-section" id="hooks-' + inst.name + '">' + buildWebhooksHTML(inst.name) + '</div>' +
    '<div class="card-actions">' + buildActions(inst) + '</div></div>';
}

function statusLabel(s) {
  return { connected:'CONECTADO', connecting:'CONECTANDO…', qr:'ESCANEA QR', logged_out:'SESIÓN CERRADA', disconnected:'DESCONECTADO' }[s] || s.toUpperCase();
}

function buildMeta(inst) {
  const since = inst.connectedAt ? new Date(inst.connectedAt).toLocaleString('es-CO', { hour12: false }) : '—';
  return 'CONECTADO DESDE <span>' + since + '</span><br>ESTADO &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span>' + inst.status + '</span>';
}

function buildQrHTML(name) {
  return '<div class="qr-wrap">' +
    '<div class="qr-label">▶ ESCANEA CON WHATSAPP ◀</div>' +
    '<img src="' + qrStore[name] + '" alt="QR ' + escHtml(name) + '">' +
    '<div style="font-size:0.62rem;color:var(--text-faint)">el QR expira en ~20s</div></div>';
}

function buildActions(inst) {
  if (inst.status === 'connected') {
    return '<button class="btn btn-danger" data-action="disconnect" data-name="' + escHtml(inst.name) + '">DESCONECTAR</button>';
  }
  return '<button class="btn btn-warn" data-action="reconnect" data-name="' + escHtml(inst.name) + '">RECONECTAR</button>' +
         '<button class="btn btn-danger" data-action="disconnect" data-name="' + escHtml(inst.name) + '">ELIMINAR</button>';
}

// ── Webhooks ────────────────────────────────────────────────────
function buildWebhooksHTML(name) {
  const hooks = webhookStore[name] || [];
  let html = '<div class="webhooks-title">WEBHOOKS <button class="btn btn-primary btn-add-hook" data-action="add-hook" data-name="' + escHtml(name) + '">+ AGREGAR</button></div>';
  if (!hooks.length) {
    html += '<div class="webhook-empty">sin webhooks configurados</div>';
  } else {
    for (const h of hooks) {
      const shortUrl = h.url.length > 40 ? h.url.slice(0, 38) + '…' : h.url;
      html += '<div class="webhook-item">' +
        '<span class="webhook-url" title="' + escHtml(h.url) + '">' + escHtml(shortUrl) + '</span>' +
        '<span class="webhook-events">' + h.events.join(', ') + '</span>' +
        '<button class="webhook-del" data-action="del-hook" data-name="' + escHtml(name) + '" data-hook-id="' + h.id + '">X</button>' +
        '</div>';
    }
  }
  return html;
}

async function fetchWebhooks(name) {
  try {
    const data = await api('GET', '/instances/' + name + '/webhooks');
    webhookStore[name] = data.webhooks || [];
  } catch (_) {
    webhookStore[name] = [];
  }
}

async function fetchAllWebhooks(instances) {
  for (const inst of instances) {
    if (inst.status === 'connected' && !webhookStore[inst.name]) {
      fetchWebhooks(inst.name);
    }
  }
}

function openWebhookModal(name) {
  document.getElementById('webhook-instance').value = name;
  document.getElementById('webhook-url-input').value = '';
  document.querySelectorAll('#webhook-modal .modal-checks input').forEach(cb => { cb.checked = cb.value === 'messages'; });
  document.getElementById('webhook-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('webhook-url-input').focus(), 50);
}

function closeWebhookModal() {
  document.getElementById('webhook-modal').classList.add('hidden');
}

async function createWebhook() {
  const name = document.getElementById('webhook-instance').value;
  const url = document.getElementById('webhook-url-input').value.trim();
  const events = Array.from(document.querySelectorAll('#webhook-modal .modal-checks input:checked')).map(cb => cb.value);

  if (!url) { toast('err', 'Ingresa la URL del webhook'); return; }
  if (!events.length) { toast('err', 'Selecciona al menos un evento'); return; }

  closeWebhookModal();
  try {
    await api('POST', '/instances/' + name + '/webhooks', { url, events });
    toast('ok', 'Webhook agregado');
    await fetchWebhooks(name);
    const hooksEl = document.getElementById('hooks-' + name);
    if (hooksEl) hooksEl.innerHTML = buildWebhooksHTML(name);
  } catch (e) { toast('err', 'Error: ' + e.message); }
}

async function deleteWebhook(name, hookId) {
  if (!confirm('¿Eliminar este webhook?')) return;
  try {
    await api('DELETE', '/instances/' + name + '/webhooks/' + hookId);
    toast('ok', 'Webhook eliminado');
    await fetchWebhooks(name);
    const hooksEl = document.getElementById('hooks-' + name);
    if (hooksEl) hooksEl.innerHTML = buildWebhooksHTML(name);
  } catch (e) { toast('err', 'Error: ' + e.message); }
}

// ── Acciones ───────────────────────────────────────────────────
async function reconnectInstance(name) {
  toast('info', 'Reconectando ' + name + '…');
  try {
    const data = await api('POST', '/instances/' + name + '/connect');
    if (data.status === 'qr') { qrStore[name] = data.qr; toast('info', 'QR listo — escanea con WhatsApp'); }
    else toast('ok', name + ' conectado');
    poll();
  } catch (e) { toast('err', 'Error: ' + e.message); }
}

async function disconnectInstance(name) {
  if (!confirm('¿Desconectar y eliminar instancia "' + name + '"?')) return;
  try {
    await api('DELETE', '/instances/' + name);
    delete qrStore[name];
    existingCards.delete(name);
    document.getElementById('card-' + name)?.remove();
    toast('ok', 'Instancia ' + name + ' eliminada');
    if (!existingCards.size) {
      document.getElementById('instances-grid').innerHTML = '<div class="empty-state"><span class="big">[∅]</span>no hay instancias activas — crea una nueva</div>';
    }
  } catch (e) { toast('err', 'Error: ' + e.message); }
}

// ── Modal ──────────────────────────────────────────────────────
function openNewModal() {
  document.getElementById('new-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-name-input').focus(), 50);
}

function closeNewModal() {
  document.getElementById('new-modal').classList.add('hidden');
  document.getElementById('new-name-input').value = '';
}

async function createInstance() {
  const name = document.getElementById('new-name-input').value.trim();
  if (!name) { toast('err', 'Ingresa un nombre'); return; }
  if (!/^[a-z0-9_-]+$/i.test(name)) { toast('err', 'Solo letras, números, guiones'); return; }
  closeNewModal();
  toast('info', 'Iniciando "' + name + '"…');
  try {
    const data = await api('POST', '/instances/' + name + '/connect');
    if (data.status === 'qr') { qrStore[name] = data.qr; toast('info', 'QR listo — escanea con WhatsApp'); }
    else if (data.status === 'connected') toast('ok', '"' + name + '" ya conectado');
    poll();
  } catch (e) { toast('err', 'Error: ' + e.message); }
}

// ── Logs ───────────────────────────────────────────────────────
async function fetchLogs() {
  try {
    const data = await api('GET', '/logs?limit=15');
    const tbody = document.getElementById('logs-body');
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="no-logs">sin registros aún</td></tr>'; return; }
    tbody.innerHTML = data.map(log => {
      const ts = new Date(log.created_at).toLocaleString('es-CO', { hour12: false });
      const dest = log.to.length > 28 ? log.to.slice(0, 26) + '…' : log.to;
      const errTip = log.error ? ' title="' + escHtml(log.error) + '"' : '';
      return '<tr>' +
        '<td>' + escHtml(log.instance) + '</td>' +
        '<td style="font-size:0.65rem">' + escHtml(dest) + '</td>' +
        '<td class="type-' + log.type + '">' + log.type.toUpperCase() + '</td>' +
        '<td class="' + (log.status === 'ok' ? 'ok' : 'error') + '"' + errTip + '>' + (log.status === 'ok' ? '✓ OK' : '✗ ERROR') + '</td>' +
        '<td style="color:var(--text-faint)">' + ts + '</td></tr>';
    }).join('');
  } catch (_) {}
}

// ── Toast ──────────────────────────────────────────────────────
let toastTimer;
function toast(type, msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'hidden', 4000);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Event listeners (no inline handlers) ────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Login
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  // Logout
  document.querySelector('.btn-logout').addEventListener('click', doLogout);

  // New instance modal
  document.querySelector('[data-id="btn-new-instance"]').addEventListener('click', openNewModal);

  // Refresh logs
  document.querySelector('[data-id="btn-refresh-logs"]').addEventListener('click', fetchLogs);

  // Modal
  document.getElementById('new-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('new-modal')) closeNewModal();
  });
  document.querySelector('[data-id="btn-modal-cancel"]').addEventListener('click', closeNewModal);
  document.querySelector('[data-id="btn-modal-create"]').addEventListener('click', createInstance);
  document.getElementById('new-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createInstance();
  });

  // Webhook modal
  document.getElementById('webhook-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('webhook-modal')) closeWebhookModal();
  });
  document.querySelector('[data-id="btn-hook-cancel"]').addEventListener('click', closeWebhookModal);
  document.querySelector('[data-id="btn-hook-create"]').addEventListener('click', createWebhook);
  document.getElementById('webhook-url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createWebhook();
  });

  // Delegated click handler for dynamic instance buttons
  document.getElementById('instances-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const name = btn.dataset.name;
    if (action === 'reconnect') reconnectInstance(name);
    else if (action === 'disconnect') disconnectInstance(name);
    else if (action === 'add-hook') openWebhookModal(name);
    else if (action === 'del-hook') deleteWebhook(name, btn.dataset.hookId);
  });
});
