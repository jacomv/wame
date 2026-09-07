import rateLimit from 'express-rate-limit';
import { getInstanceOwner } from '../accounts.js';

// Middlewares compartidos por los routers que operan sobre una instancia.
// Viven aquí para que /instances y /instances/:name/newsletters apliquen
// exactamente el mismo control de acceso y el mismo límite de envío: si el
// límite estuviera duplicado, publicar en un canal daría una vía para
// sobrepasar el cupo de mensajes.

/** Middleware: verifica que el usuario autenticado sea dueño de la instancia */
export function requireOwnership(req, res, next) {
  if (req.isAdmin) return next(); // Admin tiene acceso a todo

  const { name } = req.params;
  const owner = getInstanceOwner(name);

  // Si no tiene dueño, permitir (instancia huérfana o nueva)
  if (owner === null) return next();

  // Si el dueño es otro, denegar
  if (owner !== req.account?.id) {
    return res.status(403).json({ error: 'No tienes acceso a esta instancia' });
  }

  next();
}

// Rate limiting estricto para envío de mensajes: 30 req/min por IP
export const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.SEND_RATE_LIMIT || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de envío alcanzado. Intenta más tarde.' },
});
