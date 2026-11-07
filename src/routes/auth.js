import { Router } from 'express';
import db from '../db.js';
import rateLimit from 'express-rate-limit';
import { registerAccount, loginAccount, rotateApiKey } from '../accounts.js';
import { isAdminKey } from '../auth.js';
import { createSession, findSession, revokeSession, sessionCookie, clearSessionCookie, readSessionCookie } from '../panel-sessions.js';

const router = Router();

/**
 * ¿Se permite el registro público? Con ALLOW_REGISTRATION=false solo el admin
 * (header x-api-key con la API_KEY) puede crear cuentas. Por omisión sigue
 * cerrado por seguridad. Habilitarlo explícitamente solo si se requiere.
 */
export function registrationOpen() {
  if (process.env.ALLOW_REGISTRATION === 'false') return false;
  return process.env.ALLOW_REGISTRATION === 'true' || !db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
}

// Rate limiting estricto para auth: 10 req/min por IP
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta más tarde.' },
});

// Límite por cuenta: frena la fuerza bruta aunque el atacante cambie de IP
// (o falsifique X-Forwarded-For). Solo cuentan los intentos fallidos.
const ACCOUNT_WINDOW_MS = 15 * 60_000;
const ACCOUNT_MAX_FAILURES = 10;
const accountLimit = keyGenerator => rateLimit({
  windowMs: ACCOUNT_WINDOW_MS,
  max: ACCOUNT_MAX_FAILURES,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  skip: req => !keyGenerator(req),
  message: { error: 'Demasiados intentos fallidos para esta cuenta. Intenta en 15 minutos.' },
});
const loginAccountLimiter = accountLimit(req => {
  const email = req.body?.email;
  return typeof email === 'string' && email.trim() ? `login:${email.trim().toLowerCase()}` : '';
});
const rotateAccountLimiter = accountLimit(req => {
  const session = findSession(readSessionCookie(req));
  return session ? `rotate:${session.id}` : '';
});

// ── Config pública (el panel la lee para mostrar o no la pestaña de registro)
router.get('/config', (_req, res) => {
  res.json({ registration: registrationOpen(), mcp: process.env.MCP_ENABLED === 'true' });
});

// ── Registro ────────────────────────────────────────────────────
router.post('/register', authLimiter, (req, res) => {
  if (!registrationOpen() && !isAdminKey(req.headers['x-api-key'])) {
    return res.status(403).json({ error: 'El registro está cerrado. Pide una cuenta al administrador.' });
  }

  const { email, password } = req.body || {}

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Campo "email" requerido' });
  }
  if (!password || typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'Campo "password" requerido (mínimo 12 caracteres)' });
  }

  // Validación básica de email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Formato de email inválido' });
  }

  try {
    const result = registerAccount(email.trim().toLowerCase(), password);
    const { token } = createSession(result.id);
    res.setHeader('Set-Cookie', sessionCookie(token, req.secure));
    res.status(201).json({ ok: true, email: result.email });
  } catch (err) {
    if (err.message === 'Email already registered') {
      return res.status(409).json({ error: 'Este email ya está registrado' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Login ───────────────────────────────────────────────────────
router.post('/login', authLimiter, loginAccountLimiter, (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Campos "email" y "password" requeridos' });
  }

  const account = loginAccount(email.trim().toLowerCase(), password);
  if (!account) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const { token } = createSession(account.id);
  res.setHeader('Set-Cookie', sessionCookie(token, req.secure));
  res.json({ ok: true, email: account.email });
});

// Rotate the permanent integration credential only after password re-authentication.
// Old key becomes invalid immediately; new key is revealed exactly once.
router.post('/api-key/rotate', authLimiter, rotateAccountLimiter, (req, res) => {
  const session = findSession(readSessionCookie(req));
  if (!session) return res.status(401).json({ error: 'Sesión requerida' });
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (req.get('origin') !== expectedOrigin) return res.status(403).json({ error: 'Origen no permitido' });
  const password = req.body?.password;
  if (typeof password !== 'string' || !loginAccount(session.email, password)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const apiKey = rotateApiKey(session.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, apiKey });
});

router.get('/session', (req, res) => {
  const account = findSession(readSessionCookie(req));
  if (!account) return res.status(401).json({ error: 'Sesión expirada' });
  res.json({ ok: true, email: account.email });
});

router.post('/logout', (req, res) => {
  const expectedOrigin = `${req.protocol}://${req.get('host')}`;
  if (req.get('origin') !== expectedOrigin) return res.status(403).json({ error: 'Origen no permitido' });
  revokeSession(readSessionCookie(req));
  res.setHeader('Set-Cookie', clearSessionCookie(req.secure));
  res.json({ ok: true });
});

export default router;
