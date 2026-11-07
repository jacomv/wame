// Pantalla de consentimiento OAuth. Usa la sesión del panel (cookie) solo para
// identificar al usuario; el cliente MCP recibe un código, nunca esa cookie.
(() => {
  const lang = (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
  const EN = {
    loading: 'Loading…',
    'error.title': 'Cannot continue',
    'login.title': 'Sign in to Wame',
    'login.subtitle': 'An application is asking for access to your account. Sign in to review the request.',
    'login.password': 'Password',
    'login.btn': 'Sign in',
    'consent.wants': 'wants to use your WhatsApp on Wame',
    'consent.account': 'Account',
    'consent.redirect': 'You will return to',
    'consent.instances': 'Instances it may use',
    'consent.no_instances': 'Your account has no instances of its own. Connect one from the panel before authorizing an application.',
    'consent.scopes': 'Permissions',
    'consent.notice': 'Only authorize applications you trust. You can revoke access at any time in Wame → Connected apps.',
    'consent.deny': 'Deny',
    'consent.approve': 'Authorize',
    'err.pick_instance': 'Choose at least one instance',
    'err.pick_scope': 'Choose at least one permission',
    'err.network': 'Could not reach the server',
    'badge.sensitive': 'sensitive',
    'status.connected': 'connected',
    'status.other': 'not connected',
  };
  const ES = {
    'err.pick_instance': 'Elige al menos una instancia',
    'err.pick_scope': 'Elige al menos un permiso',
    'err.network': 'No se pudo contactar al servidor',
    'badge.sensitive': 'sensible',
    'status.connected': 'conectada',
    'status.other': 'sin conexión',
  };
  const t = key => (lang === 'en' ? EN[key] : ES[key]) ?? key;

  document.documentElement.lang = lang;
  if (lang === 'en') document.querySelectorAll('[data-t]').forEach(el => { el.textContent = EN[el.dataset.t] ?? el.textContent; });

  const requestId = new URLSearchParams(location.search).get('request') || '';
  const api = `/oauth/consent/api/${encodeURIComponent(requestId)}`;
  const $ = id => document.getElementById(id);
  const show = id => ['view-loading', 'view-error', 'view-login', 'view-consent'].forEach(v => $(v).classList.toggle('hidden', v !== id));
  const showError = msg => { $('error-text').textContent = msg; show('view-error'); };

  function row({ value, title, desc, checked, badge }) {
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = checked;
    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = title;
    if (badge) {
      const b = document.createElement('span');
      b.className = `badge ${badge.kind}`;
      b.textContent = badge.text;
      name.appendChild(b);
    }
    body.appendChild(name);
    if (desc) {
      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = desc;
      body.appendChild(d);
    }
    label.append(input, body);
    return label;
  }

  function render(data) {
    $('client-name').textContent = data.client.name;
    $('account-email').textContent = data.account;
    $('redirect-host').textContent = (() => { try { return new URL(data.redirectUri).host || data.redirectUri; } catch { return data.redirectUri; } })();

    const instances = $('instances');
    instances.replaceChildren(...data.instances.map(inst => row({
      value: inst.name,
      title: inst.name,
      desc: inst.phone ? `+${inst.phone}` : '',
      checked: data.instances.length === 1,
      badge: inst.status === 'connected'
        ? { kind: 'ok', text: t('status.connected') }
        : { kind: 'warn', text: t('status.other') },
    })));
    $('no-instances').classList.toggle('hidden', data.instances.length > 0);
    $('btn-approve').disabled = data.instances.length === 0;

    const requested = new Set(data.requestedScopes);
    $('scopes').replaceChildren(...data.availableScopes.map(scope => row({
      value: scope.name,
      title: scope.name,
      desc: scope[lang],
      // Enviar mensajes nunca viene marcado: el usuario debe activarlo a propósito.
      checked: scope.name !== 'messages:send' && (requested.size ? requested.has(scope.name) : scope.name === 'instances:read'),
      badge: scope.name === 'messages:send' ? { kind: 'danger', text: t('badge.sensitive') } : null,
    })));
    show('view-consent');
  }

  async function load() {
    if (!requestId) return showError('Falta el identificador de la solicitud.');
    try {
      const res = await fetch(api, { credentials: 'same-origin' });
      if (res.status === 401) return show('view-login');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showError(data.error || `HTTP ${res.status}`);
      render(data);
    } catch {
      showError(t('err.network'));
    }
  }

  $('view-login').addEventListener('submit', async e => {
    e.preventDefault();
    $('login-error').textContent = '';
    try {
      const res = await fetch('/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('login-email').value, password: $('login-password').value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { $('login-error').textContent = data.error || `HTTP ${res.status}`; return; }
      $('login-password').value = '';
      show('view-loading');
      load();
    } catch {
      $('login-error').textContent = t('err.network');
    }
  });

  async function decide(action, body) {
    $('consent-error').textContent = '';
    $('btn-approve').disabled = true;
    $('btn-deny').disabled = true;
    try {
      const res = await fetch(`${api}/${action}`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirect) throw new Error(data.error || `HTTP ${res.status}`);
      location.assign(data.redirect);
    } catch (err) {
      $('consent-error').textContent = err.message || t('err.network');
      $('btn-approve').disabled = false;
      $('btn-deny').disabled = false;
    }
  }

  const checked = id => [...$(id).querySelectorAll('input:checked')].map(i => i.value);
  $('btn-approve').addEventListener('click', () => {
    const instances = checked('instances');
    const scopes = checked('scopes');
    if (!instances.length) { $('consent-error').textContent = t('err.pick_instance'); return; }
    if (!scopes.length) { $('consent-error').textContent = t('err.pick_scope'); return; }
    decide('approve', { instances, scopes });
  });
  $('btn-deny').addEventListener('click', () => decide('deny'));

  load();
})();
