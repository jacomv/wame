import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

const dir = mkdtempSync(join(tmpdir(), 'wame-http-auth-'));
process.env.DATA_DIR = dir;
delete process.env.ALLOW_REGISTRATION;
const { default: db } = await import('../src/db.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { requireApiKey } = await import('../src/auth.js');
const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
app.get('/private', requireApiKey, (_req, res) => res.json({ ok: true }));
app.post('/private', requireApiKey, (_req, res) => res.json({ ok: true }));

let server;
let base;
const origin = () => base;
const post = (path, body, cookie, extra = {}) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin(), ...(cookie ? { Cookie: cookie } : {}), ...extra },
  body: JSON.stringify(body),
});
const cookieFrom = res => res.headers.get('set-cookie')?.split(';')[0];

describe('HTTP browser authentication lifecycle', () => {
  beforeAll(async () => {
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('bootstraps first account, without leaking API key', async () => {
    const res = await post('/auth/register', { email: 'first@example.test', password: 'test-password-12345' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.apiKey).toBeUndefined();
    expect(cookieFrom(res)).toMatch(/^wame_session=/);
  });

  it('closes public registration after first account', async () => {
    const res = await post('/auth/register', { email: 'second@example.test', password: 'test-password-12345' });
    expect(res.status).toBe(403);
  });

  it('logs in, restores session and revokes it on logout', async () => {
    const login = await post('/auth/login', { email: 'first@example.test', password: 'test-password-12345' });
    expect(login.status).toBe(200);
    expect((await login.json()).apiKey).toBeUndefined();
    const cookie = cookieFrom(login);
    const session = await fetch(base + '/auth/session', { headers: { Cookie: cookie } });
    expect(session.status).toBe(200);
    expect((await fetch(base + '/private', { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await post('/private', {}, cookie, { Origin: 'https://attacker.test' })).status).toBe(403);
    expect((await post('/private', {}, cookie)).status).toBe(200);
    const logout = await post('/auth/logout', {}, cookie);
    expect(logout.status).toBe(200);
    expect((await fetch(base + '/auth/session', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('rotates API keys only with a session and correct password', async () => {
    const login = await post('/auth/login', { email: 'first@example.test', password: 'test-password-12345' });
    const cookie = cookieFrom(login);
    expect((await post('/auth/api-key/rotate', { password: 'test-password-12345' })).status).toBe(401);
    expect((await post('/auth/api-key/rotate', { password: 'wrong' }, cookie)).status).toBe(401);
    expect((await post('/auth/api-key/rotate', { password: 'test-password-12345' }, cookie, { Origin: 'https://evil.test' })).status).toBe(403);
    const rotated = await post('/auth/api-key/rotate', { password: 'test-password-12345' }, cookie);
    expect(rotated.status).toBe(200);
    const { apiKey } = await rotated.json();
    expect(apiKey).toMatch(/^wame_/);
    expect((await fetch(base + '/private', { headers: { 'x-api-key': apiKey } })).status).toBe(200);
  });

  it('rejects malformed login and incorrect credentials', async () => {
    expect((await post('/auth/login', { email: {}, password: [] })).status).toBe(400);
    expect((await post('/auth/login', { email: 'first@example.test', password: 'incorrect' })).status).toBe(401);
  });
});
