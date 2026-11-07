import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'wame-session-test-'));
process.env.DATA_DIR = dir;
const { default: db } = await import('../src/db.js');
const { createSession, findSession, revokeSession, sessionCookie, clearSessionCookie, readSessionCookie } = await import('../src/panel-sessions.js');

const email = 'session-test@example.test';
const accountId = db.prepare('INSERT INTO accounts (email, password_hash, api_key) VALUES (?, ?, ?)').run(email, 'placeholder', 'session-test-api-key').lastInsertRowid;

afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe('panel sessions', () => {
  it('stores only the token hash and authenticates a valid session', () => {
    const { token, expiresAt } = createSession(accountId);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(findSession(token)?.email).toBe(email);
    const stored = db.prepare('SELECT token_hash FROM panel_sessions WHERE account_id = ?').get(accountId);
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toHaveLength(64);
  });

  it('revokes sessions immediately', () => {
    const { token } = createSession(accountId);
    revokeSession(token);
    expect(findSession(token)).toBeNull();
  });

  it('rejects expired and malformed sessions', () => {
    const { token } = createSession(accountId);
    db.prepare('UPDATE panel_sessions SET expires_at = 0 WHERE account_id = ?').run(accountId);
    expect(findSession(token)).toBeNull();
    expect(findSession(null)).toBeNull();
  });

  it('sets secure cookie attributes and clears cookies', () => {
    const cookie = sessionCookie('secret-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(readSessionCookie({ headers: { cookie: 'other=1; wame_session=secret-token' } })).toBe('secret-token');
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });
});
