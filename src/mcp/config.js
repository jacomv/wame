// Configuración del servidor MCP. Apagado por omisión: sin MCP_ENABLED=true no
// se monta ninguna ruta OAuth ni /mcp y la instalación se comporta como antes.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Lee y valida la configuración. Lanza si MCP está activo pero PUBLIC_URL no
 * sirve como emisor OAuth: mejor no arrancar que publicar metadatos erróneos.
 */
export function loadMcpConfig(env = process.env) {
  if (env.MCP_ENABLED !== 'true') return { enabled: false };

  const raw = env.PUBLIC_URL;
  if (!raw) throw new Error('MCP_ENABLED=true requiere PUBLIC_URL (por ejemplo https://wame.example.com)');

  let url;
  try { url = new URL(raw); } catch { throw new Error(`PUBLIC_URL inválida: ${raw}`); }
  if (url.search || url.hash) throw new Error('PUBLIC_URL no puede llevar query ni fragmento');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new Error('PUBLIC_URL debe usar https (http solo se admite en localhost)');
  }

  const issuer = new URL(url.origin + url.pathname.replace(/\/+$/, '') + '/');
  return {
    enabled: true,
    issuerUrl: issuer,
    // Audiencia de los tokens (RFC 8707): la URL canónica del endpoint MCP.
    resourceUrl: new URL('mcp', issuer),
    host: issuer.host,
    accessTokenTtl: positiveInt(env.MCP_ACCESS_TOKEN_TTL, 3600),
    refreshTokenTtl: positiveInt(env.MCP_REFRESH_TOKEN_TTL, 30 * 24 * 3600),
    rateLimit: positiveInt(env.MCP_RATE_LIMIT, 120),
    sendRateLimit: positiveInt(env.MCP_SEND_RATE_LIMIT, positiveInt(env.SEND_RATE_LIMIT, 30)),
    // Límites del SDK por IP: registro de clientes por hora y token/revocación por 15 min.
    registerRateLimit: positiveInt(env.MCP_REGISTER_RATE_LIMIT, 20),
    tokenRateLimit: positiveInt(env.MCP_TOKEN_RATE_LIMIT, 50),
    // Autorización (por 15 min, como el SDK) y pantalla de consentimiento (por minuto).
    authorizeRateLimit: positiveInt(env.MCP_AUTHORIZE_RATE_LIMIT, 100),
    consentRateLimit: positiveInt(env.MCP_CONSENT_RATE_LIMIT, 30),
  };
}

/** Compara URLs de recurso ignorando la barra final y el fragmento. */
export function sameResource(a, b) {
  const norm = v => {
    const text = String(v);
    const hash = text.indexOf('#');
    return (hash === -1 ? text : text.slice(0, hash)).replace(/\/$/, '');
  };
  return Boolean(a) && Boolean(b) && norm(a) === norm(b);
}
