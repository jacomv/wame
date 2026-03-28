import { timingSafeEqual } from 'crypto';
import { findByApiKey } from './accounts.js';

/** Comparación en tiempo constante para evitar timing attacks */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Middleware de autenticación.
 * Soporta:
 * 1. API key de admin global (env API_KEY) → req.account = null, req.isAdmin = true
 * 2. API key de cuenta registrada (DB)     → req.account = { id, email, ... }, req.isAdmin = false
 */
export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({ error: 'API key requerida' });
  }

  // Check admin key first
  const adminKey = process.env.API_KEY;
  if (adminKey && safeCompare(key, adminKey)) {
    req.account = null;
    req.isAdmin = true;
    return next();
  }

  // Check account key from database
  const account = findByApiKey(key);
  if (account) {
    req.account = { id: account.id, email: account.email };
    req.isAdmin = false;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}
