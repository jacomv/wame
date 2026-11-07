import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

const dir = mkdtempSync(join(tmpdir(), 'wame-followup-'));
process.env.DATA_DIR = dir;
delete process.env.ALLOW_REGISTRATION;
const { default: db } = await import('../src/db.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { trustProxySetting, jsonErrorHandler } = await import('../src/utils/http.js');

// Mismo escenario que producción expuesta: trust proxy 1 y un atacante que
// cambia X-Forwarded-For en cada intento para esquivar el límite por IP.
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/auth', authRoutes);
app.get('/boom', () => { throw new Error('detalle interno /app/src/secreto.js'); });
app.use(jsonErrorHandler);

let server;
let base;
let ip = 0;
const post = (path, body, extra = {}) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': `10.1.0.${++ip}`, ...extra },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('trustProxySetting', () => {
  it('keeps one trusted proxy by default', () => {
    expect(trustProxySetting(undefined)).toBe(1);
    expect(trustProxySetting('')).toBe(1);
  });
  it('parses booleans, hop counts and address lists', () => {
    expect(trustProxySetting('false')).toBe(false);
    expect(trustProxySetting('TRUE')).toBe(true);
    expect(trustProxySetting('2')).toBe(2);
    expect(trustProxySetting('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});

describe('auth hardening follow-up over HTTP', () => {
  beforeAll(async () => {
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('locks an account after 10 failed logins even when X-Forwarded-For changes', async () => {
    const password = 'UnaClaveDePrueba123!';
    expect((await post('/auth/register', { email: 'victima@example.test', password })).status).toBe(201);

    for (let i = 0; i < 10; i++) {
      const res = await post('/auth/login', { email: 'victima@example.test', password: `incorrecta-${i}-xxxx` });
      expect(res.status).toBe(401);
    }
    const blocked = await post('/auth/login', { email: 'VICTIMA@example.test ', password: 'otra-incorrecta-xx' });
    expect(blocked.status).toBe(429);
    // También bloquea la contraseña correcta mientras dure la ventana
    expect((await post('/auth/login', { email: 'victima@example.test', password })).status).toBe(429);
  });

  it('does not lock other accounts', async () => {
    const password = 'OtraClaveDePrueba123!';
    // Registro cerrado tras la primera cuenta: se crea directamente con el helper
    const { registerAccount } = await import('../src/accounts.js');
    registerAccount('otra@example.test', password);
    expect((await post('/auth/login', { email: 'otra@example.test', password })).status).toBe(200);
  });

  it('answers malformed JSON with a JSON 400 and no stack trace', async () => {
    const res = await post('/auth/login', '{"email":"x@example.test","password":"Secreto');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/json/);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'JSON inválido' });
    expect(text).not.toMatch(/node_modules|at JSON\.parse|Secreto/);
  });

  it('hides internal error details', async () => {
    const res = await fetch(`${base}/boom`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Error interno' });
  });
});
