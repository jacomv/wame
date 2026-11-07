import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import express from 'express';

const dir = mkdtempSync(join(tmpdir(), 'wame-mcp-'));
process.env.DATA_DIR = dir;
process.env.WEBHOOKS_DIR = join(dir, 'webhooks');
process.env.API_KEY = 'admin-key-for-tests-0123456789';
process.env.MCP_SEND_RATE_LIMIT = '5';
delete process.env.ALLOW_REGISTRATION;

// Sockets falsos: ninguna prueba toca WhatsApp.
const sent = [];
const fakeSock = {
  sendMessage: vi.fn(async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'X' } }; }),
  groupFetchAllParticipating: vi.fn(async () => ({ 'g1@g.us': { id: '120363000000000001@g.us', subject: 'Iglesia', participants: [1, 2, 3] } })),
  groupMetadata: vi.fn(async () => ({ participants: [{ id: '573001112233@s.whatsapp.net', admin: 'admin' }] })),
  onWhatsApp: vi.fn(async jid => [{ exists: true, jid }]),
};
vi.mock('../src/manager.js', () => ({
  getSocket: name => (['ventas', 'soporte', 'otra'].includes(name) ? fakeSock : null),
  getInstanceStatus: name => ({ name, status: 'connected', qr: 'QR-SECRETO', phone: '573000000000', connectedAt: '2026-11-07T00:00:00Z' }),
  getAllStatus: () => [],
  instanceExists: () => false,
  connectInstance: async () => ({}),
  disconnectInstance: async () => true,
  restartInstance: async () => ({}),
}));

const { default: db } = await import('../src/db.js');
const { loadMcpConfig } = await import('../src/mcp/config.js');
const { mountMcp } = await import('../src/mcp/index.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { default: instanceRoutes } = await import('../src/routes/instances.js');
const { default: webhookRoutes } = await import('../src/routes/webhooks.js');
const { requireApiKey } = await import('../src/auth.js');
const { registerAccount, assignInstance, rotateApiKey } = await import('../src/accounts.js');
const { createSession } = await import('../src/panel-sessions.js');
const { addWebhook } = await import('../src/webhooks.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

let server;
let base;
const REDIRECT = 'http://localhost:9999/callback';

// ── Cuentas e instancias de prueba ────────────────────────────────
const alice = registerAccount('alice@example.test', 'ClaveDeAlice12345');
const bob = registerAccount('bob@example.test', 'ClaveDeBob123456');
assignInstance('ventas', alice.id);
assignInstance('soporte', alice.id);
assignInstance('otra', bob.id);
const cookieOf = account => `wame_session=${createSession(account.id).token}`;
const aliceCookie = cookieOf(alice);
const bobCookie = cookieOf(bob);

// ── Helpers HTTP ──────────────────────────────────────────────────
const form = body => new URLSearchParams(body).toString();
const postForm = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: form(body),
});
const postJson = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient(extra = {}) {
  const res = await postJson('/register', {
    client_name: 'Cliente de prueba', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...extra,
  });
  return { status: res.status, body: await res.json() };
}

async function startAuthorization(clientId, { scope, challenge, state = 'st-123', resource = `${base}/mcp`, redirectUri = REDIRECT } = {}) {
  const url = new URL(base + '/authorize');
  const params = {
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', state,
  };
  if (scope) params.scope = scope;
  if (resource) params.resource = resource;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetch(url, { redirect: 'manual' });
}

const requestIdFrom = res => new URL(res.headers.get('location')).searchParams.get('request');

async function approve(requestId, { cookie = aliceCookie, scopes, instances, origin = base } = {}) {
  return postJson(`/oauth/consent/api/${requestId}/approve`, { scopes, instances }, { Cookie: cookie, ...(origin ? { Origin: origin } : {}) });
}

/** Flujo completo: registro, autorización, consentimiento y canje del código. */
async function authorize({ scopes = ['instances:read', 'messages:send'], instances = ['ventas'], cookie = aliceCookie, requested } = {}) {
  const { body: client } = await registerClient();
  const { verifier, challenge } = pkce();
  const res = await startAuthorization(client.client_id, { scope: (requested ?? scopes).join(' '), challenge });
  const consent = await approve(requestIdFrom(res), { cookie, scopes, instances });
  const { redirect } = await consent.json();
  const code = new URL(redirect).searchParams.get('code');
  const tokenRes = await postForm('/token', {
    grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id,
    redirect_uri: REDIRECT, resource: `${base}/mcp`,
  });
  return { client, tokens: await tokenRes.json(), tokenStatus: tokenRes.status };
}

async function mcpClient(accessToken) {
  const client = new Client({ name: 'vitest', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  return client;
}

const toolText = result => result.content?.[0]?.text ?? '';
const grantIdOf = accessToken => db.prepare('SELECT grant_id FROM oauth_access_tokens WHERE token_hash = ?')
  .get(createHash('sha256').update(accessToken).digest('hex')).grant_id;

beforeAll(async () => {
  let app;
  server = createServer((req, res) => app(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const config = loadMcpConfig({
    MCP_ENABLED: 'true', PUBLIC_URL: base, MCP_SEND_RATE_LIMIT: '5', MCP_REGISTER_RATE_LIMIT: '1000', MCP_TOKEN_RATE_LIMIT: '1000',
    MCP_AUTHORIZE_RATE_LIMIT: '1000', MCP_CONSENT_RATE_LIMIT: '1000',
  });
  app = express();
  app.set('trust proxy', 1);
  mountMcp(app, config);
  app.use(express.json());
  app.use('/auth', authRoutes);
  app.get('/status', requireApiKey, (req, res) => res.json({ ok: true, admin: req.isAdmin }));
  app.use('/instances', instanceRoutes);
  app.use('/instances', webhookRoutes);
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════
describe('configuración', () => {
  it('está apagado sin MCP_ENABLED', () => {
    expect(loadMcpConfig({})).toEqual({ enabled: false });
  });
  it('exige PUBLIC_URL https (http solo en localhost)', () => {
    expect(() => loadMcpConfig({ MCP_ENABLED: 'true' })).toThrow(/PUBLIC_URL/);
    expect(() => loadMcpConfig({ MCP_ENABLED: 'true', PUBLIC_URL: 'http://wame.example.com' })).toThrow(/https/);
    const cfg = loadMcpConfig({ MCP_ENABLED: 'true', PUBLIC_URL: 'https://wame.example.com' });
    expect(cfg.resourceUrl.href).toBe('https://wame.example.com/mcp');
  });
});

describe('descubrimiento OAuth', () => {
  it('publica los metadatos del servidor de autorización', async () => {
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(meta.issuer).toBe(`${base}/`);
    expect(meta.authorization_endpoint).toBe(`${base}/authorize`);
    expect(meta.token_endpoint).toBe(`${base}/token`);
    expect(meta.registration_endpoint).toBe(`${base}/register`);
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.scopes_supported).toContain('messages:send');
  });

  it('publica los metadatos del recurso protegido', async () => {
    const meta = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(meta.resource).toBe(`${base}/mcp`);
    expect(meta.authorization_servers).toEqual([`${base}/`]);
  });

  it('responde 401 con resource_metadata sin token', async () => {
    const res = await postJson('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
  });
});

describe('registro de clientes', () => {
  it('rechaza redirect_uri peligrosas', async () => {
    expect((await registerClient({ redirect_uris: ['javascript:alert(1)'] })).status).toBe(400);
    expect((await registerClient({ redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
    expect((await registerClient({ redirect_uris: ['https://ok.example/cb#frag'] })).status).toBe(400);
  });

  it('guarda el secreto de un cliente confidencial solo como hash', async () => {
    const { status, body } = await registerClient({ token_endpoint_auth_method: 'client_secret_post' });
    expect(status).toBe(201);
    expect(body.client_secret).toMatch(/^[0-9a-f]{64}$/);
    const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(body.client_id);
    expect(row.client_secret_hash).toBe(createHash('sha256').update(body.client_secret).digest('hex'));
    expect(row.metadata).not.toContain(body.client_secret);
  });

  it('autentica clientes confidenciales por body y por HTTP Basic', async () => {
    const { body: client } = await registerClient({ token_endpoint_auth_method: 'client_secret_post' });
    const tryToken = headers => postForm('/token', {
      grant_type: 'refresh_token', refresh_token: 'inexistente', client_id: client.client_id, ...headers.body,
    }, headers.http || {});
    const wrong = await tryToken({ body: { client_secret: 'incorrecto' } });
    expect((await wrong.json()).error).toBe('invalid_client');
    const good = await tryToken({ body: { client_secret: client.client_secret } });
    expect((await good.json()).error).toBe('invalid_grant');
    const basic = Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64');
    const viaBasic = await postForm('/token', { grant_type: 'refresh_token', refresh_token: 'inexistente' }, { Authorization: `Basic ${basic}` });
    expect((await viaBasic.json()).error).toBe('invalid_grant');
  });
});

describe('autorización con PKCE', () => {
  it('redirige al consentimiento sin emitir nada todavía', async () => {
    const { body: client } = await registerClient();
    const res = await startAuthorization(client.client_id, { scope: 'instances:read', challenge: pkce().challenge });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(new RegExp(`^${base}/oauth/consent\\?request=`));
  });

  it('rechaza permisos desconocidos, otro resource y redirect no registrado', async () => {
    const { body: client } = await registerClient();
    const bad = await startAuthorization(client.client_id, { scope: 'admin:all', challenge: pkce().challenge });
    expect(new URL(bad.headers.get('location')).searchParams.get('error')).toBe('invalid_scope');
    const other = await startAuthorization(client.client_id, { challenge: pkce().challenge, resource: 'https://otro.example/mcp' });
    expect(new URL(other.headers.get('location')).searchParams.get('error')).toBe('invalid_target');
    const redirect = await startAuthorization(client.client_id, { challenge: pkce().challenge, redirectUri: 'http://localhost:9999/otro' });
    expect(redirect.status).toBe(400);
  });

  it('exige PKCE S256', async () => {
    const { body: client } = await registerClient();
    const url = `${base}/authorize?response_type=code&client_id=${client.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}`;
    const res = await fetch(url, { redirect: 'manual' });
    expect(new URL(res.headers.get('location')).searchParams.get('error')).toBe('invalid_request');
  });

  it('el consentimiento exige sesión del panel y mismo origen', async () => {
    const { body: client } = await registerClient();
    const id = requestIdFrom(await startAuthorization(client.client_id, { scope: 'instances:read', challenge: pkce().challenge }));
    expect((await fetch(`${base}/oauth/consent/api/${id}`)).status).toBe(401);
    expect((await approve(id, { scopes: ['instances:read'], instances: ['ventas'], origin: null })).status).toBe(403);
    expect((await approve(id, { scopes: ['instances:read'], instances: ['ventas'], origin: 'https://evil.example' })).status).toBe(403);
    const info = await (await fetch(`${base}/oauth/consent/api/${id}`, { headers: { Cookie: aliceCookie } })).json();
    expect(info.client.name).toBe('Cliente de prueba');
    expect(info.instances.map(i => i.name).sort()).toEqual(['soporte', 'ventas']);
  });

  it('no deja autorizar instancias ajenas ni permisos no pedidos', async () => {
    const { body: client } = await registerClient();
    const id = requestIdFrom(await startAuthorization(client.client_id, { scope: 'instances:read', challenge: pkce().challenge }));
    expect((await approve(id, { scopes: ['instances:read'], instances: ['otra'] })).status).toBe(403);
    expect((await approve(id, { scopes: ['messages:send'], instances: ['ventas'] })).status).toBe(400);
  });

  it('rechazar devuelve access_denied con el state', async () => {
    const { body: client } = await registerClient();
    const id = requestIdFrom(await startAuthorization(client.client_id, { scope: 'instances:read', challenge: pkce().challenge, state: 'abc' }));
    const res = await postJson(`/oauth/consent/api/${id}/deny`, {}, { Cookie: aliceCookie, Origin: base });
    const url = new URL((await res.json()).redirect);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('canjea el código con el verifier correcto, una sola vez', async () => {
    const { body: client } = await registerClient();
    const { verifier, challenge } = pkce();
    const id = requestIdFrom(await startAuthorization(client.client_id, { scope: 'instances:read', challenge }));
    const { redirect } = await (await approve(id, { scopes: ['instances:read'], instances: ['ventas'] })).json();
    const url = new URL(redirect);
    expect(url.searchParams.get('state')).toBe('st-123');
    expect(url.searchParams.get('iss')).toBe(`${base}/`);
    const code = url.searchParams.get('code');

    const exchange = v => postForm('/token', { grant_type: 'authorization_code', code, code_verifier: v, client_id: client.client_id, redirect_uri: REDIRECT });
    expect((await (await exchange(pkce().verifier)).json()).error).toBe('invalid_grant');
    const ok = await exchange(verifier);
    const tokens = await ok.json();
    expect(ok.status).toBe(200);
    expect(tokens.access_token).toMatch(/^wame_at_/);
    expect(tokens.refresh_token).toMatch(/^wame_rt_/);
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.scope).toBe('instances:read');
    expect((await (await exchange(verifier)).json()).error).toBe('invalid_grant');
    // La aprobación pendiente también era de un solo uso.
    expect((await approve(id, { scopes: ['instances:read'], instances: ['ventas'] })).status).toBe(404);
  });

  it('rechaza el canje con otro redirect_uri', async () => {
    const { body: client } = await registerClient({ redirect_uris: [REDIRECT, 'http://localhost:9999/otro'] });
    const { verifier, challenge } = pkce();
    const id = requestIdFrom(await startAuthorization(client.client_id, { scope: 'instances:read', challenge }));
    const code = new URL((await (await approve(id, { scopes: ['instances:read'], instances: ['ventas'] })).json()).redirect).searchParams.get('code');
    const res = await postForm('/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: 'http://localhost:9999/otro' });
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('no guarda códigos ni tokens en claro', async () => {
    const { tokens } = await authorize();
    const dump = JSON.stringify([
      db.prepare('SELECT * FROM oauth_access_tokens').all(),
      db.prepare('SELECT * FROM oauth_refresh_tokens').all(),
      db.prepare('SELECT * FROM oauth_authorization_codes').all(),
      db.prepare('SELECT * FROM mcp_audit_log').all(),
    ]);
    expect(dump).not.toContain(tokens.access_token);
    expect(dump).not.toContain(tokens.refresh_token);
  });
});

describe('tokens', () => {
  it('rechaza tokens inválidos y vencidos', async () => {
    const res = await postJson('/mcp', {}, { Authorization: 'Bearer wame_at_falso' });
    expect(res.status).toBe(401);

    const { tokens } = await authorize();
    db.prepare('UPDATE oauth_access_tokens SET expires_at = 1 WHERE token_hash = ?')
      .run(createHash('sha256').update(tokens.access_token).digest('hex'));
    const expired = await postJson('/mcp', {}, { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json, text/event-stream' });
    expect(expired.status).toBe(401);
    expect(expired.headers.get('www-authenticate')).toContain('invalid_token');
  });

  it('rota el refresh token y revoca todo si se reutiliza', async () => {
    const { client, tokens } = await authorize();
    const refresh = rt => postForm('/token', { grant_type: 'refresh_token', refresh_token: rt, client_id: client.client_id });
    const next = await (await refresh(tokens.refresh_token)).json();
    expect(next.access_token).toBeTruthy();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);

    const reuse = await (await refresh(tokens.refresh_token)).json();
    expect(reuse.error).toBe('invalid_grant');
    // El reuso revoca el grant completo, incluidos los tokens recién emitidos.
    const after = await postJson('/mcp', {}, { Authorization: `Bearer ${next.access_token}` });
    expect(after.status).toBe(401);
    expect((await (await refresh(next.refresh_token)).json()).error).toBe('invalid_grant');
  });

  it('no deja ampliar permisos con el refresh token', async () => {
    const { client, tokens } = await authorize({ scopes: ['instances:read'], requested: ['instances:read'] });
    const res = await postForm('/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id, scope: 'messages:send' });
    expect((await res.json()).error).toBe('invalid_scope');
  });

  it('el cliente puede revocar su access token', async () => {
    const { client, tokens } = await authorize();
    const res = await postForm('/revoke', { token: tokens.access_token, client_id: client.client_id });
    expect(res.status).toBe(200);
    expect((await postJson('/mcp', {}, { Authorization: `Bearer ${tokens.access_token}` })).status).toBe(401);
  });

  it('los tokens de un cliente no los revoca otro', async () => {
    const { tokens } = await authorize();
    const { body: other } = await registerClient();
    await postForm('/revoke', { token: tokens.access_token, client_id: other.client_id });
    const mcp = await mcpClient(tokens.access_token);
    expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
    await mcp.close();
  });
});

describe('herramientas MCP', () => {
  it('lista solo las herramientas de los permisos concedidos', async () => {
    const { tokens } = await authorize({ scopes: ['instances:read'], requested: ['instances:read'] });
    const mcp = await mcpClient(tokens.access_token);
    const names = (await mcp.listTools()).tools.map(t => t.name).sort();
    expect(names).toEqual(['get_instance_status', 'list_instances']);
    const call = await mcp.callTool({ name: 'send_text', arguments: { instance: 'ventas', to: '573001112233', text: 'hola' } }).catch(e => e);
    expect(String(call.message ?? toolText(call))).toMatch(/not found|no encontrad/i);
    await mcp.close();
  });

  it('list_instances solo muestra las autorizadas y nunca el QR', async () => {
    const { tokens } = await authorize({ scopes: ['instances:read'], instances: ['ventas'], requested: ['instances:read'] });
    const mcp = await mcpClient(tokens.access_token);
    const result = await mcp.callTool({ name: 'list_instances', arguments: {} });
    const data = JSON.parse(toolText(result));
    expect(data.instances.map(i => i.name)).toEqual(['ventas']);
    expect(toolText(result)).not.toContain('QR-SECRETO');
    const status = await mcp.callTool({ name: 'get_instance_status', arguments: { instance: 'ventas' } });
    expect(toolText(status)).not.toContain('QR-SECRETO');
    await mcp.close();
  });

  it('send_text envía, registra y audita sin guardar el texto', async () => {
    const { tokens } = await authorize();
    const mcp = await mcpClient(tokens.access_token);
    sent.length = 0;
    const result = await mcp.callTool({ name: 'send_text', arguments: { instance: 'ventas', to: '+57 300 111 2233', text: 'Mensaje privado 123' } });
    expect(result.isError).toBeFalsy();
    expect(sent).toEqual([{ jid: '573001112233@s.whatsapp.net', content: { text: 'Mensaje privado 123' } }]);
    const log = db.prepare("SELECT * FROM message_logs WHERE instance = 'ventas' ORDER BY id DESC LIMIT 1").get();
    expect(log.status).toBe('ok');
    const audit = db.prepare("SELECT * FROM mcp_audit_log WHERE tool = 'send_text' ORDER BY id DESC LIMIT 1").get();
    expect(audit.outcome).toBe('ok');
    expect(JSON.stringify(db.prepare('SELECT * FROM mcp_audit_log').all())).not.toContain('Mensaje privado');
    await mcp.close();
  });

  it('rechaza instancias no autorizadas, ajenas y canales', async () => {
    const { tokens } = await authorize({ instances: ['ventas'] });
    const mcp = await mcpClient(tokens.access_token);
    const notGranted = await mcp.callTool({ name: 'send_text', arguments: { instance: 'soporte', to: '573001112233', text: 'x' } });
    expect(notGranted.isError).toBe(true);
    expect(toolText(notGranted)).toMatch(/no está autorizada/);
    const foreign = await mcp.callTool({ name: 'send_text', arguments: { instance: 'otra', to: '573001112233', text: 'x' } });
    expect(foreign.isError).toBe(true);
    const channel = await mcp.callTool({ name: 'send_text', arguments: { instance: 'ventas', to: '120363000000000000@newsletter', text: 'x' } });
    expect(channel.isError).toBe(true);
    expect(toolText(channel)).toMatch(/inválido/);
    await mcp.close();
  });

  it('aplica en el acto la reducción de permisos y el cambio de dueño', async () => {
    const { tokens } = await authorize({ scopes: ['instances:read', 'messages:send'], instances: ['ventas', 'soporte'] });
    const mcp = await mcpClient(tokens.access_token);
    const grantId = grantIdOf(tokens.access_token);

    db.prepare("UPDATE mcp_grants SET scopes = 'instances:read' WHERE id = ?").run(grantId);
    // La siguiente petición ya ni registra send_text: el servidor la rechaza.
    const noScope = await mcp.callTool({ name: 'send_text', arguments: { instance: 'ventas', to: '573001112233', text: 'x' } }).catch(e => e);
    expect(noScope.isError ?? true).toBe(true);
    expect(String(noScope.message ?? toolText(noScope))).toMatch(/not found/i);
    // Y el handler revalida por su cuenta aunque la herramienta estuviera registrada.
    const { authorizeCall } = await import('../src/mcp/tools.js');
    expect(() => authorizeCall({ extra: { grantId } }, 'messages:send', 'ventas')).toThrow(/messages:send/);
    expect(() => authorizeCall({ extra: { grantId } }, 'instances:read', 'ventas')).not.toThrow();
    expect(() => authorizeCall({ extra: { grantId: 999999 } }, 'instances:read', 'ventas')).toThrow(/revocada/);

    db.prepare("UPDATE mcp_grants SET scopes = 'instances:read messages:send' WHERE id = ?").run(grantId);
    db.prepare("UPDATE instance_owners SET account_id = ? WHERE instance_name = 'soporte'").run(bob.id);
    const moved = await mcp.callTool({ name: 'send_text', arguments: { instance: 'soporte', to: '573001112233', text: 'x' } });
    expect(moved.isError).toBe(true);
    expect(toolText(moved)).toMatch(/ya no pertenece/);
    db.prepare("UPDATE instance_owners SET account_id = ? WHERE instance_name = 'soporte'").run(alice.id);
    await mcp.close();
  });

  it('bloquea URLs de multimedia hacia redes privadas', async () => {
    const { tokens } = await authorize();
    const mcp = await mcpClient(tokens.access_token);
    for (const url of ['http://127.0.0.1/a.jpg', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/a.jpg', 'https://example.com:8443/a.jpg']) {
      const r = await mcp.callTool({ name: 'send_media', arguments: { instance: 'ventas', to: '573001112233', type: 'image', url } });
      expect(r.isError, url).toBe(true);
    }
    await mcp.close();
  });

  it('valida parámetros antes de ejecutar', async () => {
    const { tokens } = await authorize({ scopes: ['groups:read', 'contacts:read'], requested: ['groups:read', 'contacts:read'] });
    const mcp = await mcpClient(tokens.access_token);
    const badGroup = await mcp.callTool({ name: 'get_group_participants', arguments: { instance: 'ventas', group_id: '../../etc' } });
    expect(badGroup.isError).toBe(true);
    const badName = await mcp.callTool({ name: 'list_groups', arguments: { instance: '../ventas' } });
    expect(badName.isError).toBe(true);
    const groups = await mcp.callTool({ name: 'list_groups', arguments: { instance: 'ventas' } });
    expect(JSON.parse(toolText(groups)).groups[0].name).toBe('Iglesia');
    const check = await mcp.callTool({ name: 'check_whatsapp_number', arguments: { instance: 'ventas', number: '+57 300 111 2233' } });
    expect(JSON.parse(toolText(check)).exists).toBe(true);
    await mcp.close();
  });

  it('list_webhooks oculta los parámetros de la URL', async () => {
    await addWebhook('ventas', { url: 'https://hooks.example/in?token=secreto', events: ['messages'] });
    const { tokens } = await authorize({ scopes: ['webhooks:read'], requested: ['webhooks:read'] });
    const mcp = await mcpClient(tokens.access_token);
    const text = toolText(await mcp.callTool({ name: 'list_webhooks', arguments: { instance: 'ventas' } }));
    expect(text).toContain('https://hooks.example/in');
    expect(text).not.toContain('secreto');
    await mcp.close();
  });

  it('limita los envíos por autorización', async () => {
    const { tokens } = await authorize();
    const mcp = await mcpClient(tokens.access_token);
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await mcp.callTool({ name: 'send_text', arguments: { instance: 'ventas', to: '573001112233', text: `n${i}` } }));
    }
    expect(results.slice(0, 5).every(r => !r.isError)).toBe(true);
    expect(toolText(results[5])).toMatch(/Límite/);
    await mcp.close();
  });

  it('rechaza un Host distinto (DNS rebinding)', async () => {
    const { tokens } = await authorize();
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(`${base}/mcp`, {
        method: 'POST',
        headers: { Host: 'evil.example', Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    });
    expect(status).toBe(403);
  });
});

describe('aislamiento entre cuentas', () => {
  it('bob no puede autorizar ni usar instancias de alice', async () => {
    const { body: client } = await registerClient();
    const id = requestIdFrom(await startAuthorization(client.client_id, { scope: 'instances:read messages:send', challenge: pkce().challenge }));
    const info = await (await fetch(`${base}/oauth/consent/api/${id}`, { headers: { Cookie: bobCookie } })).json();
    expect(info.instances.map(i => i.name)).toEqual(['otra']);
    expect((await approve(id, { cookie: bobCookie, scopes: ['messages:send'], instances: ['ventas'] })).status).toBe(403);

    const { tokens } = await authorize({ cookie: bobCookie, instances: ['otra'] });
    const mcp = await mcpClient(tokens.access_token);
    const r = await mcp.callTool({ name: 'send_text', arguments: { instance: 'ventas', to: '573001112233', text: 'x' } });
    expect(r.isError).toBe(true);
    const list = JSON.parse(toolText(await mcp.callTool({ name: 'list_instances', arguments: {} })));
    expect(list.instances.map(i => i.name)).toEqual(['otra']);
    await mcp.close();
  });
});

describe('aplicaciones conectadas', () => {
  it('lista y revoca con efecto inmediato en el servidor', async () => {
    const { tokens } = await authorize({ instances: ['ventas'] });
    const mcp = await mcpClient(tokens.access_token);
    await mcp.callTool({ name: 'list_instances', arguments: {} });
    const grantId = grantIdOf(tokens.access_token);

    const { apps } = await (await fetch(`${base}/auth/connected-apps`, { headers: { Cookie: aliceCookie } })).json();
    const app = apps.find(a => a.id === grantId);
    expect(app.client.name).toBe('Cliente de prueba');
    expect(app.instances).toEqual([{ name: 'ventas', owned: true }]);
    expect(app.scopes.map(s => s.name)).toEqual(['instances:read', 'messages:send']);
    expect(app.lastUsedAt).toBeTruthy();
    expect(app.lastActivity.tool).toBe('list_instances');

    // Otra cuenta no ve ni revoca este grant.
    const bobApps = await (await fetch(`${base}/auth/connected-apps`, { headers: { Cookie: bobCookie } })).json();
    expect(bobApps.apps.some(a => a.id === grantId)).toBe(false);
    const foreign = await fetch(`${base}/auth/connected-apps/${grantId}`, { method: 'DELETE', headers: { Cookie: bobCookie, Origin: base } });
    expect(foreign.status).toBe(404);
    // Sin Origin del mismo sitio tampoco.
    expect((await fetch(`${base}/auth/connected-apps/${grantId}`, { method: 'DELETE', headers: { Cookie: aliceCookie } })).status).toBe(403);

    const res = await fetch(`${base}/auth/connected-apps/${grantId}`, { method: 'DELETE', headers: { Cookie: aliceCookie, Origin: base } });
    expect(res.status).toBe(200);
    expect((await postJson('/mcp', {}, { Authorization: `Bearer ${tokens.access_token}` })).status).toBe(401);
    expect(db.prepare('SELECT count(*) n FROM oauth_refresh_tokens WHERE grant_id = ?').get(grantId).n).toBe(0);
    const after = await (await fetch(`${base}/auth/connected-apps`, { headers: { Cookie: aliceCookie } })).json();
    expect(after.apps.some(a => a.id === grantId)).toBe(false);
    expect(db.prepare("SELECT count(*) n FROM mcp_audit_log WHERE event = 'grant_revoked' AND grant_id = ?").get(grantId).n).toBe(1);
  });

  it('volver a autorizar el mismo cliente reemplaza el grant', async () => {
    const { body: client } = await registerClient();
    const run = async (scopes, instances) => {
      const { verifier, challenge } = pkce();
      const id = requestIdFrom(await startAuthorization(client.client_id, { scope: scopes.join(' '), challenge }));
      const code = new URL((await (await approve(id, { scopes, instances })).json()).redirect).searchParams.get('code');
      return (await postForm('/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT })).json();
    };
    const first = await run(['instances:read', 'messages:send'], ['ventas', 'soporte']);
    const second = await run(['instances:read'], ['ventas']);
    expect(grantIdOf(first.access_token)).toBe(grantIdOf(second.access_token));
    const mcp = await mcpClient(first.access_token);
    expect((await mcp.listTools()).tools.map(t => t.name)).not.toContain('send_text');
    await mcp.close();
  });
});

describe('compatibilidad y separación de credenciales', () => {
  it('la API REST sigue funcionando con x-api-key y rechaza tokens MCP', async () => {
    expect((await fetch(`${base}/status`, { headers: { 'x-api-key': process.env.API_KEY } })).status).toBe(200);
    const key = rotateApiKey(alice.id);
    expect((await fetch(`${base}/status`, { headers: { 'x-api-key': key } })).status).toBe(200);
    const { tokens } = await authorize();
    expect((await fetch(`${base}/status`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
    expect((await fetch(`${base}/status`, { headers: { 'x-api-key': tokens.access_token } })).status).toBe(401);
  });

  it('/mcp no acepta la API key ni la cookie del panel', async () => {
    const headers = { Accept: 'application/json, text/event-stream' };
    expect((await postJson('/mcp', {}, { ...headers, 'x-api-key': process.env.API_KEY })).status).toBe(401);
    expect((await postJson('/mcp', {}, { ...headers, Cookie: aliceCookie })).status).toBe(401);
  });

  it('la API REST mantiene sus respuestas tras extraer los servicios', async () => {
    const key = rotateApiKey(alice.id);
    sent.length = 0;
    const ok = await postJson('/instances/ventas/send', { to: '573001112233', type: 'text', text: 'hola' }, { 'x-api-key': key });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const missing = await postJson('/instances/ventas/send', { to: '573001112233' }, { 'x-api-key': key });
    expect(missing.status).toBe(400);
    const badTo = await postJson('/instances/ventas/send', { to: 'abc', type: 'text', text: 'x' }, { 'x-api-key': key });
    expect(badTo.status).toBe(400);
    const notConnected = await postJson('/instances/nada/send', { to: '573001112233', type: 'text', text: 'x' }, { 'x-api-key': process.env.API_KEY });
    expect(notConnected.status).toBe(503);
    const foreign = await postJson('/instances/otra/send', { to: '573001112233', type: 'text', text: 'x' }, { 'x-api-key': key });
    expect(foreign.status).toBe(403);
    const groups = await fetch(`${base}/instances/ventas/groups`, { headers: { 'x-api-key': key } });
    expect((await groups.json())[0].participants).toBe(3);
    const check = await postJson('/instances/ventas/check-number', {}, { 'x-api-key': key });
    expect(check.status).toBe(400);
    const status = await fetch(`${base}/instances/ventas/status`, { headers: { 'x-api-key': key } });
    expect((await status.json()).qr).toBe('QR-SECRETO'); // el panel REST sí necesita el QR
  });
});
