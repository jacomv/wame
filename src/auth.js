import { timingSafeEqual } from 'crypto';
import { findByApiKey } from './accounts.js';
import { findSession, readSessionCookie } from './panel-sessions.js';

/** Comparación en tiempo constante para evitar timing attacks */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** ¿Es esta la API key de admin (env API_KEY)? */
export function isAdminKey(key) {
  const adminKey = process.env.API_KEY;
  return Boolean(adminKey) && safeCompare(key, adminKey);
}

/**
 * Middleware de autenticación.
 * Soporta:
 * 1. API key de admin global (env API_KEY) → req.account = null, req.isAdmin = true
 * 2. API key de cuenta registrada (DB)     → req.account = { id, email, ... }, req.isAdmin = false
 */
export function requireApiKey(req, res, next) {
  // Explicit API credentials take precedence over ambient browser cookies.
  const key = req.headers['x-api-key'];
  if (!key) {
    const session = findSession(readSessionCookie(req));
    if (!session) return res.status(401).json({ error: 'Autenticación requerida' });

    // Require same-origin Origin for every cookie-authenticated mutation.
    // Reject missing Origin, cross-origin forms and opaque origins.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expectedOrigin = `${req.protocol}://${req.get('host')}`;
      if (req.get('origin') !== expectedOrigin) {
        return res.status(403).json({ error: 'Origen no permitido' });
      }
    }
    req.account = session;
    req.isAdmin = false;
    return next();
  }

  // Check admin key first
  if (isAdminKey(key)) {
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
