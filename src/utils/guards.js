import rateLimit from 'express-rate-limit';
import { assignInstance, getInstanceOwner } from '../accounts.js';
import { instanceExists } from '../manager.js';

// Middlewares compartidos por los routers que operan sobre una instancia.
// Viven aquí para que /instances, /instances/:name/newsletters y
// /instances/:name/webhooks apliquen exactamente el mismo control de acceso y
// el mismo límite de envío: si el límite estuviera duplicado, publicar en un
// canal daría una vía para sobrepasar el cupo de mensajes.

/**
 * Middleware: verifica que el usuario autenticado sea dueño de la instancia.
 * Una instancia sin dueño (creada con la key de admin, o anterior al sistema de
 * cuentas) es solo del admin: si cualquier cuenta pudiera usarla, cualquiera
 * que se registre podría enviar desde ese número o borrarlo.
 */
export function requireOwnership(req, res, next) {
  if (req.isAdmin) return next(); // Admin tiene acceso a todo

  const owner = getInstanceOwner(req.params.name);
  if (owner === null || owner !== req.account?.id) {
    return res.status(403).json({ error: 'No tienes acceso a esta instancia' });
  }

  next();
}

/**
 * Middleware para /connect: como requireOwnership, pero si el nombre está libre
 * (sin dueño y sin sesión) la cuenta lo reclama antes de conectar. Reclamar
 * primero cierra la carrera de dos cuentas conectando el mismo nombre nuevo:
 * el INSERT OR IGNORE deja un solo dueño y la otra recibe 403.
 */
export function requireOwnershipOrClaim(req, res, next) {
  if (req.isAdmin) return next();

  const { name } = req.params;
  if (getInstanceOwner(name) === null && !instanceExists(name)) {
    assignInstance(name, req.account.id);
  }

  return requireOwnership(req, res, next);
}

// Rate limiting estricto para envío de mensajes: 30 req/min por IP
export const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.SEND_RATE_LIMIT || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de envío alcanzado. Intenta más tarde.' },
});
