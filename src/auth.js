import { timingSafeEqual } from 'crypto';

export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || !safeCompare(key, process.env.API_KEY ?? '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** Comparación en tiempo constante para evitar timing attacks */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
