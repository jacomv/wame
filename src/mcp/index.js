// Monta el servidor MCP remoto: OAuth 2.1 (router del SDK + proveedor propio),
// la pantalla de consentimiento, la gestión de aplicaciones conectadas y el
// endpoint Streamable HTTP /mcp. Tres credenciales separadas:
//   panel → cookie de sesión · REST → x-api-key · MCP → Bearer OAuth.
import express from 'express';
import cors from 'cors';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { findSession, readSessionCookie } from '../panel-sessions.js';
import { getOwnedInstances, getInstanceOwner } from '../accounts.js';
import { getInstanceStatus } from '../manager.js';
import { createProvider } from './provider.js';
import { createMcpServer } from './tools.js';
import { SCOPES, SCOPE_NAMES, normalizeScopes } from './scopes.js';
import * as store from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')).version;
const CLIENT_SECRET_TTL = 90 * 24 * 3600;

const sameOrigin = req => req.get('origin') === `${req.protocol}://${req.get('host')}`;
const scopeList = names => names.map(name => ({ name, ...SCOPES[name] }));

/**
 * El SDK compara client_secret en claro contra lo que devuelve getClient, que
 * aquí es un hash. Se hashea el secreto recibido (en el body o por HTTP Basic)
 * antes de que llegue al SDK, así el secreto nunca se guarda en claro.
 */
function hashSubmittedClientSecret(req, _res, next) {
  const auth = req.get('authorization');
  if (auth?.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep > 0) {
        req.body = req.body || {};
        req.body.client_id ??= decodeURIComponent(decoded.slice(0, sep));
        req.body.client_secret ??= decodeURIComponent(decoded.slice(sep + 1));
      }
    } catch { /* cabecera malformada: el SDK responderá invalid_client */ }
  }
  if (typeof req.body?.client_secret === 'string') req.body.client_secret = store.sha256(req.body.client_secret);
  next();
}

/** Sesión del panel para las APIs de consentimiento y aplicaciones conectadas. */
function requirePanelSession(req, res, next) {
  const account = findSession(readSessionCookie(req));
  if (!account) return res.status(401).json({ error: 'Sesión requerida' });
  if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  req.account = account;
  next();
}

function consentRouter(config) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60_000, max: config.consentRateLimit, standardHeaders: true, legacyHeaders: false });
  router.use(limiter, express.json({ limit: '16kb' }));

  const loadRequest = (req, res) => {
    const pending = store.getPending(req.params.id);
    if (!pending) {
      res.status(404).json({ error: 'La solicitud de autorización venció o ya se usó. Vuelve a conectar desde la aplicación.' });
      return null;
    }
    const client = store.getClient(pending.client_id);
    if (!client) {
      res.status(404).json({ error: 'Cliente desconocido' });
      return null;
    }
    return { pending, client };
  };

  const redirectWith = (pending, params) => {
    const url = new URL(pending.redirect_uri);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (pending.state) url.searchParams.set('state', pending.state);
    // RFC 9207: idéntico al issuer publicado en los metadatos.
    url.searchParams.set('iss', config.issuerUrl.href);
    return url.href;
  };

  router.get('/:id', requirePanelSession, (req, res) => {
    const ctx = loadRequest(req, res);
    if (!ctx) return;
    const { pending, client } = ctx;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      account: req.account.email,
      client: store.describeClient(client),
      redirectUri: pending.redirect_uri,
      // Sin scopes pedidos se ofrecen todos y el usuario elige; si el cliente
      // pidió algunos, no se puede conceder nada fuera de esa lista.
      requestedScopes: pending.scopes,
      availableScopes: scopeList(pending.scopes.length ? pending.scopes : SCOPE_NAMES),
      instances: getOwnedInstances(req.account.id).map(name => {
        const s = getInstanceStatus(name);
        return { name, status: s?.status ?? 'not_loaded', phone: s?.phone ?? null };
      }),
    });
  });

  router.post('/:id/approve', requirePanelSession, (req, res) => {
    const ctx = loadRequest(req, res);
    if (!ctx) return;
    const { pending, client } = ctx;
    const { scopes, instances } = req.body || {};

    if (!Array.isArray(scopes) || !scopes.length || scopes.some(s => typeof s !== 'string')) {
      return res.status(400).json({ error: 'Elige al menos un permiso' });
    }
    const allowed = pending.scopes.length ? pending.scopes : SCOPE_NAMES;
    if (scopes.some(s => !allowed.includes(s))) return res.status(400).json({ error: 'Permiso no solicitado por el cliente' });

    if (!Array.isArray(instances) || !instances.length || instances.length > 50 || instances.some(i => typeof i !== 'string')) {
      return res.status(400).json({ error: 'Elige al menos una instancia' });
    }
    const unique = [...new Set(instances)];
    if (unique.some(name => getInstanceOwner(name) !== req.account.id)) {
      return res.status(403).json({ error: 'Solo puedes autorizar instancias de tu cuenta' });
    }

    const granted = normalizeScopes(scopes);
    store.deletePending(req.params.id);
    const grant = store.upsertGrant({
      accountId: req.account.id, clientId: client.client_id, scopes: granted, resource: pending.resource, instances: unique,
    });
    const code = store.createCode({
      grantId: grant.id, clientId: client.client_id, redirectUri: pending.redirect_uri,
      codeChallenge: pending.code_challenge, resource: pending.resource,
    });
    store.audit(grant.updated ? 'consent_updated' : 'consent_granted', {
      accountId: req.account.id, grantId: grant.id, clientId: client.client_id,
      detail: `${granted.join(' ')} | ${unique.join(',')}`,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ redirect: redirectWith(pending, { code }) });
  });

  router.post('/:id/deny', requirePanelSession, (req, res) => {
    const ctx = loadRequest(req, res);
    if (!ctx) return;
    store.deletePending(req.params.id);
    store.audit('consent_denied', { accountId: req.account.id, clientId: ctx.client.client_id });
    res.json({ redirect: redirectWith(ctx.pending, { error: 'access_denied', error_description: 'El usuario rechazó la autorización' }) });
  });

  return router;
}

function connectedAppsRouter() {
  const router = express.Router();
  router.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));

  router.get('/', requirePanelSession, (req, res) => {
    const apps = store.listGrants(req.account.id).map(grant => {
      const client = store.getClient(grant.clientId);
      const last = store.lastActivity(grant.id);
      return {
        id: grant.id,
        client: client ? store.describeClient(client) : { clientId: grant.clientId, name: 'Cliente eliminado', redirectHosts: [] },
        scopes: scopeList(grant.scopes),
        instances: grant.instances.map(name => ({ name, owned: getInstanceOwner(name) === req.account.id })),
        createdAt: grant.createdAt,
        updatedAt: grant.updatedAt,
        lastUsedAt: grant.lastUsedAt,
        lastActivity: last && { at: last.created_at, tool: last.tool, instance: last.instance, outcome: last.outcome },
      };
    });
    res.json({ apps });
  });

  router.delete('/:id', requirePanelSession, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const grant = Number.isInteger(id) ? store.getGrant(id) : null;
    // Un grant ajeno responde igual que uno inexistente.
    if (!grant || grant.accountId !== req.account.id || grant.revokedAt) {
      return res.status(404).json({ error: 'Aplicación no encontrada' });
    }
    store.revokeGrant(grant.id);
    store.audit('grant_revoked', { accountId: req.account.id, grantId: grant.id, clientId: grant.clientId, detail: 'desde el panel' });
    res.json({ ok: true });
  });

  return router;
}

/**
 * Monta todo lo de MCP en la app. Debe llamarse antes del CORS y el rate limit
 * globales: /mcp y los endpoints OAuth tienen sus propias reglas.
 */
export function mountMcp(app, config) {
  const provider = createProvider(config);
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUrl);

  // Endpoints OAuth estándar (metadatos, /authorize, /token, /register, /revoke).
  app.use(['/token', '/revoke'], express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' }), hashSubmittedClientSecret);
  app.use(mcpAuthRouter({
    provider,
    issuerUrl: config.issuerUrl,
    resourceServerUrl: config.resourceUrl,
    resourceName: 'WAME — WhatsApp',
    scopesSupported: SCOPE_NAMES,
    clientRegistrationOptions: { clientSecretExpirySeconds: CLIENT_SECRET_TTL, rateLimit: { max: config.registerRateLimit } },
    tokenOptions: { rateLimit: { max: config.tokenRateLimit } },
    authorizationOptions: { rateLimit: { max: config.authorizeRateLimit } },
    revocationOptions: { rateLimit: { max: config.tokenRateLimit } },
  }));

  // Pantalla de consentimiento (HTML estático + API con la sesión del panel).
  app.get('/oauth/consent', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(__dirname, '../public/oauth/consent.html'));
  });
  app.use('/oauth/consent/api', consentRouter(config));
  app.use('/auth/connected-apps', connectedAppsRouter());

  // ── Endpoint MCP (Streamable HTTP, sin estado) ─────────────────
  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    max: config.rateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    // Por token: varios usuarios de un mismo cliente comparten IP de salida.
    keyGenerator: req => {
      const auth = req.get('authorization');
      return auth ? `t:${store.sha256(auth).slice(0, 32)}` : `ip:${ipKeyGenerator(req.ip)}`;
    },
    handler: (_req, res) => res.status(429).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Demasiadas peticiones' }, id: null }),
  });

  app.use('/mcp', cors({
    origin: true,
    methods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Mcp-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
    exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
  }));
  app.all('/mcp',
    mcpLimiter,
    requireBearerAuth({ verifier: provider, resourceMetadataUrl, expectedResource: config.resourceUrl }),
    express.json({ limit: '256kb' }),
    async (req, res) => {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método no permitido: este servidor no mantiene sesiones' }, id: null });
      }
      const grant = store.getGrant(req.auth.extra.grantId);
      const server = createMcpServer({ grant, config, version: VERSION });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts: [config.host],
      });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        console.error('[mcp] Error atendiendo la petición:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno' }, id: null });
        }
      }
    });

  store.purgeExpired();
  setInterval(() => store.purgeExpired(), 60 * 60_000).unref();
  console.log(`[mcp] Servidor MCP activo en ${config.resourceUrl.href}`);
}
