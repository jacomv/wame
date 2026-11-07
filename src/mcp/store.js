// Persistencia del OAuth y de los grants MCP. Todo secreto entra y sale de aquí
// en claro solo en el momento de emitirlo; en la base queda su SHA-256.
import { randomBytes, createHash } from 'node:crypto';
import db from '../db.js';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const newSecret = (prefix = '') => prefix + randomBytes(32).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);
const isoNow = () => new Date().toISOString();

// ── Clientes (registro dinámico, RFC 7591) ──────────────────────
const stmtClientInsert = db.prepare(`INSERT INTO oauth_clients
  (client_id, client_secret_hash, client_secret_expires_at, metadata) VALUES (?, ?, ?, ?)`);
const stmtClientGet = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?');

/**
 * Guarda el cliente con el secreto hasheado. Devuelve la información completa
 * (con el secreto en claro) para la respuesta del registro, la única vez que sale.
 */
export function saveClient(client) {
  const { client_secret, ...metadata } = client;
  stmtClientInsert.run(
    client.client_id,
    client_secret ? sha256(client_secret) : null,
    client.client_secret_expires_at ?? null,
    JSON.stringify(metadata),
  );
  return client;
}

/**
 * Devuelve el cliente tal como lo espera el SDK. `client_secret` es el hash: el
 * middleware hashSubmittedClientSecret hashea el secreto recibido antes de que
 * el SDK lo compare, así nunca se guarda ni se compara el secreto en claro.
 */
export function getClient(clientId) {
  if (typeof clientId !== 'string' || clientId.length > 200) return undefined;
  const row = stmtClientGet.get(clientId);
  if (!row) return undefined;
  const client = JSON.parse(row.metadata);
  if (row.client_secret_hash) {
    client.client_secret = row.client_secret_hash;
    client.client_secret_expires_at = row.client_secret_expires_at ?? undefined;
  }
  return client;
}

/** Nombre legible del cliente para la pantalla de consentimiento y el panel. */
export function describeClient(client) {
  const redirectHosts = [...new Set((client.redirect_uris || []).map(u => {
    try { return new URL(u).host; } catch { return null; }
  }).filter(Boolean))];
  let clientUri = null;
  try { if (client.client_uri) clientUri = new URL(client.client_uri).origin; } catch { /* inválida */ }
  return {
    clientId: client.client_id,
    name: typeof client.client_name === 'string' && client.client_name.trim()
      ? client.client_name.trim().slice(0, 100)
      : 'Cliente sin nombre',
    clientUri,
    redirectHosts,
  };
}

// ── Autorizaciones pendientes de consentimiento ─────────────────
const PENDING_TTL = 10 * 60;
const stmtPendingInsert = db.prepare(`INSERT INTO oauth_pending_authorizations
  (id_hash, client_id, redirect_uri, code_challenge, state, scopes, resource, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const stmtPendingGet = db.prepare('SELECT * FROM oauth_pending_authorizations WHERE id_hash = ? AND expires_at > ?');
const stmtPendingDelete = db.prepare('DELETE FROM oauth_pending_authorizations WHERE id_hash = ?');

export function createPending({ clientId, redirectUri, codeChallenge, state, scopes, resource }) {
  const id = newSecret();
  stmtPendingInsert.run(sha256(id), clientId, redirectUri, codeChallenge, state ?? null,
    scopes.join(' '), resource, nowSec() + PENDING_TTL);
  return id;
}

export function getPending(id) {
  if (typeof id !== 'string' || !id || id.length > 100) return null;
  const row = stmtPendingGet.get(sha256(id), nowSec());
  if (!row) return null;
  return { ...row, scopes: row.scopes ? row.scopes.split(' ') : [] };
}

export function deletePending(id) {
  stmtPendingDelete.run(sha256(id));
}

// ── Grants ──────────────────────────────────────────────────────
const stmtGrantFind = db.prepare(`SELECT * FROM mcp_grants
  WHERE account_id = ? AND client_id = ? AND resource = ? AND revoked_at IS NULL`);
const stmtGrantInsert = db.prepare('INSERT INTO mcp_grants (account_id, client_id, scopes, resource) VALUES (?, ?, ?, ?)');
const stmtGrantUpdate = db.prepare('UPDATE mcp_grants SET scopes = ?, updated_at = ? WHERE id = ?');
const stmtGrantGet = db.prepare('SELECT * FROM mcp_grants WHERE id = ?');
const stmtGrantInstancesClear = db.prepare('DELETE FROM mcp_grant_instances WHERE grant_id = ?');
const stmtGrantInstanceAdd = db.prepare('INSERT OR IGNORE INTO mcp_grant_instances (grant_id, instance_name) VALUES (?, ?)');
const stmtGrantInstances = db.prepare('SELECT instance_name FROM mcp_grant_instances WHERE grant_id = ? ORDER BY instance_name');
const stmtGrantTouch = db.prepare('UPDATE mcp_grants SET last_used_at = ? WHERE id = ?');
const stmtGrantRevoke = db.prepare('UPDATE mcp_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL');
const stmtGrantsByAccount = db.prepare('SELECT * FROM mcp_grants WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC');

/**
 * Crea el grant de una cuenta para un cliente, o actualiza el existente: volver
 * a autorizar el mismo cliente reemplaza permisos e instancias en vez de
 * acumular autorizaciones paralelas.
 */
export const upsertGrant = db.transaction(({ accountId, clientId, scopes, resource, instances }) => {
  const existing = stmtGrantFind.get(accountId, clientId, resource);
  let id;
  if (existing) {
    id = existing.id;
    stmtGrantUpdate.run(scopes.join(' '), isoNow(), id);
  } else {
    id = Number(stmtGrantInsert.run(accountId, clientId, scopes.join(' '), resource).lastInsertRowid);
  }
  stmtGrantInstancesClear.run(id);
  for (const name of instances) stmtGrantInstanceAdd.run(id, name);
  return { id, updated: Boolean(existing) };
});

function hydrateGrant(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    clientId: row.client_id,
    scopes: row.scopes ? row.scopes.split(' ') : [],
    resource: row.resource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    instances: stmtGrantInstances.all(row.id).map(r => r.instance_name),
  };
}

export function getGrant(id) {
  return hydrateGrant(stmtGrantGet.get(id));
}

export function listGrants(accountId) {
  return stmtGrantsByAccount.all(accountId).map(hydrateGrant);
}

export function touchGrant(id) {
  stmtGrantTouch.run(isoNow(), id);
}

/** Revoca el grant y borra todos sus códigos y tokens. Devuelve false si ya estaba revocado. */
export const revokeGrant = db.transaction(id => {
  const changed = stmtGrantRevoke.run(isoNow(), id).changes > 0;
  db.prepare('DELETE FROM oauth_authorization_codes WHERE grant_id = ?').run(id);
  db.prepare('DELETE FROM oauth_access_tokens WHERE grant_id = ?').run(id);
  db.prepare('DELETE FROM oauth_refresh_tokens WHERE grant_id = ?').run(id);
  return changed;
});

/** Revoca todas las autorizaciones activas de una cuenta. Devuelve los ids revocados. */
export const revokeAllGrants = db.transaction(accountId => {
  const ids = stmtGrantsByAccount.all(accountId).map(r => r.id);
  for (const id of ids) revokeGrant(id);
  return ids;
});

// ── Interruptor por cuenta ──────────────────────────────────────
const stmtSettingGet = db.prepare('SELECT enabled FROM mcp_account_settings WHERE account_id = ?');
const stmtSettingSet = db.prepare(`INSERT INTO mcp_account_settings (account_id, enabled, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(account_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`);

/** ¿La cuenta permite aplicaciones MCP? Sin preferencia guardada, sí. */
export function isAccountMcpEnabled(accountId) {
  const row = stmtSettingGet.get(accountId);
  return row ? row.enabled === 1 : true;
}

export function setAccountMcpEnabled(accountId, enabled) {
  stmtSettingSet.run(accountId, enabled ? 1 : 0, isoNow());
}

/** Quita una instancia de todos los grants (por ejemplo, al borrarla). */
export function removeInstanceFromGrants(instanceName) {
  db.prepare('DELETE FROM mcp_grant_instances WHERE instance_name = ?').run(instanceName);
}

// ── Códigos de autorización ─────────────────────────────────────
const CODE_TTL = 5 * 60;
const stmtCodeInsert = db.prepare(`INSERT INTO oauth_authorization_codes
  (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const stmtCodeGet = db.prepare('SELECT * FROM oauth_authorization_codes WHERE code_hash = ?');
const stmtCodeDelete = db.prepare('DELETE FROM oauth_authorization_codes WHERE code_hash = ?');

export function createCode({ grantId, clientId, redirectUri, codeChallenge, resource }) {
  const code = newSecret();
  stmtCodeInsert.run(sha256(code), grantId, clientId, redirectUri, codeChallenge, resource, nowSec() + CODE_TTL);
  return code;
}

/** Lee un código vigente sin consumirlo (el SDK pide el challenge antes del canje). */
export function peekCode(code) {
  if (typeof code !== 'string' || !code || code.length > 100) return null;
  const row = stmtCodeGet.get(sha256(code));
  return row && row.expires_at > nowSec() ? row : null;
}

/** Consume un código: de un solo uso, se borra aunque el canje falle después. */
export function consumeCode(code) {
  const row = peekCode(code);
  if (row) stmtCodeDelete.run(row.code_hash);
  return row;
}

// ── Tokens ──────────────────────────────────────────────────────
const stmtAccessInsert = db.prepare('INSERT INTO oauth_access_tokens (token_hash, grant_id, client_id, expires_at) VALUES (?, ?, ?, ?)');
const stmtAccessGet = db.prepare('SELECT * FROM oauth_access_tokens WHERE token_hash = ?');
const stmtAccessDelete = db.prepare('DELETE FROM oauth_access_tokens WHERE token_hash = ? AND client_id = ?');
const stmtRefreshInsert = db.prepare('INSERT INTO oauth_refresh_tokens (token_hash, grant_id, client_id, expires_at) VALUES (?, ?, ?, ?)');
const stmtRefreshGet = db.prepare('SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?');
const stmtRefreshRotate = db.prepare('UPDATE oauth_refresh_tokens SET rotated_at = ? WHERE token_hash = ? AND rotated_at IS NULL');

/** Emite un par de tokens para un grant. Los prefijos permiten reconocerlos en un escaneo de secretos. */
export function issueTokens(grantId, clientId, { accessTtl, refreshTtl }) {
  const accessToken = newSecret('wame_at_');
  const refreshToken = newSecret('wame_rt_');
  const now = nowSec();
  stmtAccessInsert.run(sha256(accessToken), grantId, clientId, now + accessTtl);
  stmtRefreshInsert.run(sha256(refreshToken), grantId, clientId, now + refreshTtl);
  return { accessToken, refreshToken, expiresIn: accessTtl };
}

export function findAccessToken(token) {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  return stmtAccessGet.get(sha256(token)) ?? null;
}

export function findRefreshToken(token) {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  return stmtRefreshGet.get(sha256(token)) ?? null;
}

/** Marca un refresh token como usado. Devuelve false si ya se había rotado (reuso). */
export function markRefreshRotated(tokenHash) {
  return stmtRefreshRotate.run(nowSec(), tokenHash).changes > 0;
}

export function deleteAccessToken(token, clientId) {
  return stmtAccessDelete.run(sha256(token), clientId).changes > 0;
}

// ── Auditoría (nunca secretos ni contenido de mensajes) ─────────
const stmtAudit = db.prepare(`INSERT INTO mcp_audit_log
  (event, account_id, grant_id, client_id, instance, tool, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const stmtLastActivity = db.prepare(`SELECT created_at, event, tool, instance, outcome FROM mcp_audit_log
  WHERE grant_id = ? AND event = 'tool_call' ORDER BY id DESC LIMIT 1`);

export function audit(event, { accountId = null, grantId = null, clientId = null, instance = null, tool = null, outcome = null, detail = null } = {}) {
  try {
    stmtAudit.run(event, accountId, grantId, clientId, instance, tool, outcome,
      detail == null ? null : String(detail).slice(0, 300));
  } catch (err) {
    console.error('[mcp] Error guardando auditoría:', err.message);
  }
}

export function lastActivity(grantId) {
  return stmtLastActivity.get(grantId) ?? null;
}

// ── Limpieza periódica ──────────────────────────────────────────
// Los refresh rotados se conservan hasta su vencimiento para detectar reusos.
export function purgeExpired() {
  const now = nowSec();
  db.prepare('DELETE FROM oauth_pending_authorizations WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM oauth_authorization_codes WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM oauth_access_tokens WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM oauth_refresh_tokens WHERE expires_at <= ?').run(now);
  db.prepare("DELETE FROM mcp_audit_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-180 days')").run();
  db.prepare(`DELETE FROM oauth_clients WHERE client_secret_expires_at IS NOT NULL AND client_secret_expires_at > 0
    AND client_secret_expires_at <= ? AND client_id NOT IN (SELECT client_id FROM mcp_grants WHERE revoked_at IS NULL)`).run(now);
}
