import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'wame-auth-integration-'));
process.env.DATA_DIR = dir;
process.env.API_KEY = 'integration-admin-secret';
const { default: db } = await import('../src/db.js');
const { registerAccount, rotateApiKey, findByApiKey } = await import('../src/accounts.js');
const { createSession } = await import('../src/panel-sessions.js');
const { requireApiKey } = await import('../src/auth.js');
const { default: authRoutes } = await import('../src/routes/auth.js');

const email = 'auth-integration@example.test';
const password = 'a-strong-test-password';
const apiKey = registerAccount(email, password).apiKey;
const accountId = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email).id;
const token = createSession(accountId).token;
const cookie = `wame_session=${token}`;

function authorize(method, headers = {}, origin) {
  const req = {
    method,
    protocol: 'https',
    headers: { ...headers, ...(origin ? { origin } : {}) },
    get: name => name === 'host' ? 'wame.example.test' : name === 'origin' ? origin : undefined,
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  requireApiKey(req, res, next);
  return { req, res, next };
}

describe('panel cookie and API key isolation', () => {
  afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('accepts a valid cookie for GET', () => {
    const { req, next } = authorize('GET', { cookie });
    expect(next).toHaveBeenCalledOnce();
    expect(req.account.id).toBe(accountId);
  });

  it('requires same origin for cookie POST, PUT and DELETE', () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      for (const origin of [undefined, 'https://evil.example']) {
        const { res, next } = authorize(method, { cookie }, origin);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
      }
      expect(authorize(method, { cookie }, 'https://wame.example.test').next).toHaveBeenCalledOnce();
    }
  });

  it('preserves API-key access for integrations without Origin', () => {
    const { req, next } = authorize('POST', { 'x-api-key': apiKey });
    expect(next).toHaveBeenCalledOnce();
    expect(req.account.id).toBe(accountId);
  });

  it('uses explicit API key before browser session', () => {
    const { req, next } = authorize('GET', { cookie, 'x-api-key': 'integration-admin-secret' });
    expect(next).toHaveBeenCalledOnce();
    expect(req.isAdmin).toBe(true);
  });

  it('does not fall back to a cookie when explicit API key is invalid', () => {
    const { res, next } = authorize('GET', { cookie, 'x-api-key': 'bad-key' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('stores API key hashes and revokes previous keys on rotation', () => {
    const stored = db.prepare('SELECT api_key FROM accounts WHERE id = ?').get(accountId).api_key;
    expect(stored).not.toBe(apiKey);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    const nextKey = rotateApiKey(accountId);
    expect(nextKey).toMatch(/^wame_/);
    expect(findByApiKey(apiKey)).toBeNull();
    expect(findByApiKey(nextKey)?.id).toBe(accountId);
  });

  it('rejects absent credentials', () => {
    const { res, next } = authorize('GET');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
