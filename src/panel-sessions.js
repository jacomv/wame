import { randomBytes, createHash } from 'node:crypto';
import db from './db.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = 'wame_session';

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(accountId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO panel_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), accountId, expiresAt);
  return { token, expiresAt };
}

export function findSession(token) {
  if (typeof token !== 'string' || !token) return null;
  const row = db.prepare(`SELECT a.id, a.email FROM panel_sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash(token), Date.now());
  return row ?? null;
}

export function revokeSession(token) {
  if (typeof token !== 'string' || !token) return;
  db.prepare('DELETE FROM panel_sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function sessionCookie(token, secure = true) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = true) {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readSessionCookie(req) {
  const cookies = req.headers.cookie;
  if (typeof cookies !== 'string') return null;
  const item = cookies.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE_NAME + '='));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(COOKIE_NAME.length + 1)); }
  catch { return null; }
}
