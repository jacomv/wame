// Prueba de punta a punta con un cliente MCP real (cliente oficial del SDK) y un
// navegador real para el consentimiento. Nunca contra producción.
//   BASE=http://localhost:3200 E2E_EMAIL=... E2E_PASSWORD=... E2E_INSTANCE=demo node scripts/mcp-e2e.mjs
// Requiere playwright instalado (npm i -D playwright o una ruta en PLAYWRIGHT_PATH).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

const BASE = process.env.BASE || 'http://localhost:3200';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const INSTANCE = process.env.E2E_INSTANCE || 'demo';
const CALLBACK_PORT = Number(process.env.E2E_CALLBACK_PORT || 18765);
const REDIRECT = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
if (!EMAIL || !PASSWORD) throw new Error('Define E2E_EMAIL y E2E_PASSWORD');
if (/soberanagracia\.com/.test(BASE)) throw new Error('Esta prueba no se ejecuta contra producción');

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

let pass = 0;
let fail = 0;
const check = (cond, label, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${extra ? ` — ${extra}` : ''}`);
};

// ── Proveedor OAuth del cliente: guarda todo en memoria ───────────
const state = {};
let authorizationUrl = null;
const provider = {
  get redirectUrl() { return REDIRECT; },
  get clientMetadata() {
    return {
      client_name: 'E2E MCP Client',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'instances:read messages:send messages:read',
    };
  },
  clientInformation: () => state.client,
  saveClientInformation: info => { state.client = info; },
  tokens: () => state.tokens,
  saveTokens: tokens => { state.tokens = tokens; },
  redirectToAuthorization: url => { authorizationUrl = url; },
  saveCodeVerifier: v => { state.verifier = v; },
  codeVerifier: () => state.verifier,
};

// ── Servidor del callback: recibe el código como lo haría una app nativa ──
const codePromise = new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    res.end('OK, puedes cerrar esta ventana.');
    server.close();
    const error = url.searchParams.get('error');
    error ? reject(new Error(error)) : resolve({ code: url.searchParams.get('code'), iss: url.searchParams.get('iss'), state: url.searchParams.get('state') });
  }).listen(CALLBACK_PORT, '127.0.0.1');
});

const mcpUrl = new URL(`${BASE}/mcp`);
let transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
let client = new Client({ name: 'e2e', version: '1.0.0' });

// 1) Sin token: el cliente descubre el servidor de autorización y se registra.
try {
  await client.connect(transport);
  check(false, 'La primera conexión debía pedir autorización');
} catch (err) {
  check(err instanceof UnauthorizedError, 'El servidor exige OAuth (401 → descubrimiento)');
}
check(Boolean(state.client?.client_id), 'Registro dinámico del cliente', state.client?.client_id);
check(authorizationUrl?.searchParams.get('code_challenge_method') === 'S256', 'Autorización con PKCE S256');
console.log(`     scope pedido por el cliente: ${authorizationUrl?.searchParams.get('scope')}`);
check(authorizationUrl?.searchParams.get('resource') === mcpUrl.href, 'Pide el token para este recurso', authorizationUrl?.searchParams.get('resource'));

// 2) Navegador: login en Wame y consentimiento.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(authorizationUrl.href);
await page.waitForSelector('#view-login:not(.hidden)');
check(true, 'La pantalla de consentimiento pide iniciar sesión');
await page.fill('#login-email', EMAIL);
await page.fill('#login-password', PASSWORD);
await page.click('#view-login button[type=submit]');
await page.waitForSelector('#view-consent:not(.hidden)');
const clientName = await page.textContent('#client-name');
check(clientName === 'E2E MCP Client', 'Muestra qué cliente pide acceso', clientName);
check(await page.locator(`#instances input[value="${INSTANCE}"]`).count() === 1, `Ofrece la instancia ${INSTANCE}`);
const offered = await page.$$eval('#scopes input', els => els.map(e => e.value));
const requestedScopes = (authorizationUrl.searchParams.get('scope') || '').split(' ').filter(Boolean);
check(requestedScopes.every(s => offered.includes(s)) && offered.every(s => requestedScopes.includes(s)), 'Ofrece exactamente los permisos pedidos', offered.join(' '));
check(!(await page.isChecked('#scopes input[value="messages:send"]')), 'messages:send no viene marcado por defecto');
// El usuario concede solo ver instancias y enviar mensajes.
await page.check(`#instances input[value="${INSTANCE}"]`);
for (const scope of offered) {
  const want = ['instances:read', 'messages:send'].includes(scope);
  await page.setChecked(`#scopes input[value="${scope}"]`, want);
}
await page.screenshot({ path: process.env.E2E_SCREENSHOT || '/tmp/mcp-consent.png' });
await page.click('#btn-approve');
const callback = await codePromise;
await browser.close();
check(Boolean(callback.code), 'Redirige al cliente con el código');
check(callback.iss === `${BASE}/`, 'Incluye iss (RFC 9207)', callback.iss);

// 3) El cliente canjea el código y se conecta.
await transport.finishAuth(callback.code);
check(state.tokens?.access_token?.startsWith('wame_at_'), 'Token de acceso emitido');
check(state.tokens?.scope === 'instances:read messages:send', 'El token refleja lo que el usuario concedió', state.tokens?.scope);
transport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
client = new Client({ name: 'e2e', version: '1.0.0' });
await client.connect(transport);
const tools = (await client.listTools()).tools.map(t => t.name).sort();
check(tools.join(',') === 'get_instance_status,list_instances,send_media,send_text', 'Herramientas según permisos', tools.join(','));

const list = JSON.parse((await client.callTool({ name: 'list_instances', arguments: {} })).content[0].text);
check(list.instances.length === 1 && list.instances[0].name === INSTANCE, 'list_instances devuelve solo la instancia autorizada', JSON.stringify(list.instances));
const send = await client.callTool({ name: 'send_text', arguments: { instance: INSTANCE, to: '573001112233', text: 'prueba e2e' } });
check(send.isError && /no conectada/.test(send.content[0].text), 'send_text llega al backend (sin WhatsApp: "no conectada")', send.content[0].text);
const ssrf = await client.callTool({ name: 'send_media', arguments: { instance: INSTANCE, to: '573001112233', type: 'image', url: 'http://169.254.169.254/latest/meta-data' } });
check(ssrf.isError, 'send_media bloquea SSRF', ssrf.content[0].text);
const other = await client.callTool({ name: 'get_instance_status', arguments: { instance: 'ajena' } });
check(other.isError, 'Otra instancia: rechazada', other.content[0].text);
await client.close();

// 4) Refresh: el cliente renueva y el token viejo de refresco queda inservible.
const oldRefresh = state.tokens.refresh_token;
const refreshRes = await fetch(`${BASE}/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: oldRefresh, client_id: state.client.client_id }),
});
const refreshed = await refreshRes.json();
check(refreshRes.ok && refreshed.refresh_token !== oldRefresh, 'Refresh con rotación');
state.tokens = refreshed;

console.log(`\nACCESS_TOKEN_FOR_INSPECTOR=${refreshed.access_token}`);
console.log(`RESULTADO: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
