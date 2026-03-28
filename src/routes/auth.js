import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { registerAccount, loginAccount } from '../accounts.js';

const router = Router();

// Rate limiting estricto para auth: 10 req/min por IP
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta más tarde.' },
});

// ── Registro ────────────────────────────────────────────────────
router.post('/register', authLimiter, (req, res) => {
  const { email, password } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Campo "email" requerido' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Campo "password" requerido (mínimo 6 caracteres)' });
  }

  // Validación básica de email
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Formato de email inválido' });
  }

  try {
    const result = registerAccount(email.trim().toLowerCase(), password);
    res.status(201).json({
      ok: true,
      email: result.email,
      apiKey: result.apiKey,
    });
  } catch (err) {
    if (err.message === 'Email already registered') {
      return res.status(409).json({ error: 'Este email ya está registrado' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Login ───────────────────────────────────────────────────────
router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Campos "email" y "password" requeridos' });
  }

  const account = loginAccount(email.trim().toLowerCase(), password);
  if (!account) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  res.json({
    ok: true,
    email: account.email,
    apiKey: account.apiKey,
  });
});

export default router;
