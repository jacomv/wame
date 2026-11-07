// Proveedor OAuth 2.1 para el router del SDK de MCP. El SDK valida la forma de
// las peticiones, el redirect_uri registrado y el PKCE (S256); aquí se decide
// quién recibe qué, contra la base de datos.
import {
  InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError,
  InvalidClientMetadataError, InvalidRequestError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { isValidScope, normalizeScopes } from './scopes.js';
import { sameResource } from './config.js';
import * as store from './store.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:', 'filesystem:']);

/**
 * redirect_uri aceptables: https, http solo en loopback (apps nativas, RFC 8252)
 * y esquemas privados de apps (vscode://, cursor://). Nunca javascript:, data:…
 */
export function isAllowedRedirectUri(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.hash) return false;
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

const DISABLED = 'Las aplicaciones de IA están desactivadas en esta cuenta';

export function createProvider(config) {
  const ttl = { accessTtl: config.accessTokenTtl, refreshTtl: config.refreshTokenTtl };
  const resource = config.resourceUrl.href;

  const clientsStore = {
    getClient: async clientId => store.getClient(clientId),
    registerClient: async client => {
      const uris = client.redirect_uris || [];
      if (!uris.length || uris.length > 10) {
        throw new InvalidClientMetadataError('Se requieren entre 1 y 10 redirect_uris');
      }
      const bad = uris.find(u => !isAllowedRedirectUri(u));
      if (bad) throw new InvalidClientMetadataError(`redirect_uri no permitida: ${String(bad).slice(0, 100)}`);
      if (client.client_name && String(client.client_name).length > 200) {
        throw new InvalidClientMetadataError('client_name demasiado largo');
      }
      const grantTypes = client.grant_types || ['authorization_code', 'refresh_token'];
      if (grantTypes.some(g => !['authorization_code', 'refresh_token'].includes(g))) {
        throw new InvalidClientMetadataError('Solo se admiten authorization_code y refresh_token');
      }
      store.saveClient(client);
      store.audit('client_registered', { clientId: client.client_id, detail: store.describeClient(client).name });
      return client;
    },
  };

  return {
    clientsStore,

    async authorize(client, params, res) {
      const scopes = params.scopes || [];
      const unknown = scopes.filter(s => !isValidScope(s));
      if (unknown.length) throw new InvalidScopeError(`Permisos desconocidos: ${unknown.join(', ').slice(0, 200)}`);
      if (params.resource && !sameResource(params.resource.href, resource)) {
        throw new InvalidTargetError('Este servidor solo emite tokens para su endpoint MCP');
      }
      if (params.state && params.state.length > 500) throw new InvalidRequestError('state demasiado largo');

      const id = store.createPending({
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        scopes: normalizeScopes(scopes),
        resource,
      });
      store.audit('authorization_requested', { clientId: client.client_id, detail: scopes.join(' ') || '(sin scopes)' });
      res.redirect(302, new URL(`oauth/consent?request=${encodeURIComponent(id)}`, config.issuerUrl).href);
    },

    async challengeForAuthorizationCode(client, code) {
      const row = store.peekCode(code);
      if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Código inválido o vencido');
      return row.code_challenge;
    },

    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
      const row = store.consumeCode(code);
      if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Código inválido o vencido');
      // OAuth 2.1 §4.1.3: el redirect_uri del canje debe coincidir con el de la autorización.
      if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
        throw new InvalidGrantError('redirect_uri no coincide con la autorización');
      }
      if (requestedResource && !sameResource(requestedResource.href, row.resource)) {
        throw new InvalidTargetError('resource no coincide con la autorización');
      }
      const grant = store.getGrant(row.grant_id);
      if (!grant || grant.revokedAt) throw new InvalidGrantError('La autorización fue revocada');
      if (!store.isAccountMcpEnabled(grant.accountId)) throw new InvalidGrantError(DISABLED);

      const t = store.issueTokens(grant.id, client.client_id, ttl);
      store.audit('token_issued', { accountId: grant.accountId, grantId: grant.id, clientId: client.client_id });
      return {
        access_token: t.accessToken,
        token_type: 'bearer',
        expires_in: t.expiresIn,
        refresh_token: t.refreshToken,
        scope: grant.scopes.join(' '),
      };
    },

    async exchangeRefreshToken(client, refreshToken, scopes, requestedResource) {
      const row = store.findRefreshToken(refreshToken);
      if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Refresh token inválido');
      if (row.expires_at <= Math.floor(Date.now() / 1000)) throw new InvalidGrantError('Refresh token vencido');

      const grant = store.getGrant(row.grant_id);
      if (!grant || grant.revokedAt) throw new InvalidGrantError('La autorización fue revocada');
      // Se comprueba antes de rotar: con la cuenta apagada el refresh token no se gasta
      // y vuelve a servir cuando el usuario reactive las aplicaciones.
      if (!store.isAccountMcpEnabled(grant.accountId)) throw new InvalidGrantError(DISABLED);

      // Un refresh token rotado que vuelve a aparecer indica robo: se revoca todo el grant.
      if (row.rotated_at || !store.markRefreshRotated(row.token_hash)) {
        store.revokeGrant(grant.id);
        store.audit('refresh_token_reuse', { accountId: grant.accountId, grantId: grant.id, clientId: client.client_id, outcome: 'grant_revoked' });
        throw new InvalidGrantError('Refresh token ya utilizado; la autorización fue revocada');
      }
      if (requestedResource && !sameResource(requestedResource.href, grant.resource)) {
        throw new InvalidTargetError('resource no coincide con la autorización');
      }
      if (scopes?.some(s => !grant.scopes.includes(s))) {
        throw new InvalidScopeError('No se pueden ampliar los permisos con un refresh token');
      }

      const t = store.issueTokens(grant.id, client.client_id, ttl);
      store.audit('token_refreshed', { accountId: grant.accountId, grantId: grant.id, clientId: client.client_id });
      return {
        access_token: t.accessToken,
        token_type: 'bearer',
        expires_in: t.expiresIn,
        refresh_token: t.refreshToken,
        scope: grant.scopes.join(' '),
      };
    },

    async verifyAccessToken(token) {
      const row = store.findAccessToken(token);
      if (!row) throw new InvalidTokenError('Token inválido');
      if (row.expires_at <= Math.floor(Date.now() / 1000)) throw new InvalidTokenError('Token vencido');
      const grant = store.getGrant(row.grant_id);
      if (!grant || grant.revokedAt) throw new InvalidTokenError('La autorización fue revocada');
      if (!store.isAccountMcpEnabled(grant.accountId)) throw new InvalidTokenError(DISABLED);
      return {
        token,
        clientId: row.client_id,
        // Los permisos salen del grant en cada petición: revocar o reducir es inmediato.
        scopes: grant.scopes,
        expiresAt: row.expires_at,
        resource: new URL(grant.resource),
        extra: { grantId: grant.id, accountId: grant.accountId },
      };
    },

    async revokeToken(client, { token, token_type_hint: hint }) {
      // RFC 7009: responder 200 aunque el token no exista o sea de otro cliente.
      if (hint !== 'refresh_token' && store.deleteAccessToken(token, client.client_id)) {
        store.audit('token_revoked', { clientId: client.client_id, detail: 'access_token' });
        return;
      }
      const row = store.findRefreshToken(token);
      if (row && row.client_id === client.client_id) {
        const grant = store.getGrant(row.grant_id);
        store.revokeGrant(row.grant_id);
        store.audit('grant_revoked', { accountId: grant?.accountId, grantId: row.grant_id, clientId: client.client_id, detail: 'por el cliente' });
      }
    },
  };
}
