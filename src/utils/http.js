// Ajustes HTTP compartidos por el servidor y las pruebas.

/**
 * Traduce TRUST_PROXY al valor de `app.set('trust proxy')`.
 * Sin definir se mantiene 1 (un proxy delante: Traefik, Dokploy, Nginx), que es
 * como corre WAME en producción. Si el puerto queda expuesto sin proxy hay que
 * poner TRUST_PROXY=false: si no, cualquiera elige su IP con X-Forwarded-For y
 * esquiva el rate limit por IP.
 */
export function trustProxySetting(value) {
  if (value === undefined || value.trim() === '') return 1;
  const v = value.trim().toLowerCase();
  if (v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return value.trim(); // lista de IPs/subredes de confianza o 'loopback', 'uniquelocal'...
}

/**
 * Último middleware: responde JSON y nunca devuelve el stack al cliente.
 * Los errores de parseo no se registran porque su mensaje trae un trozo del body
 * (puede ser parte de una contraseña).
 */
export function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Body demasiado grande' });

  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(`[http] ${req.method} ${req.path}: ${err.message}`);
  res.status(status).json({ error: status === 500 ? 'Error interno' : 'Petición inválida' });
}
