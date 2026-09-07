// ── Normalizar JID ──────────────────────────────────────────────
export function normalizeJid(to) {
  // Si ya es un JID completo (tiene @), solo limpiar espacios
  if (to.includes('@')) return to.trim();
  // Solo número: limpiar formato telefónico común
  const cleaned = to.replace(/[\s+()-]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

// ── Canales (newsletters) ───────────────────────────────────────
// Los canales usan el servidor @newsletter y su ID es siempre numérico.
const NEWSLETTER_JID = /^\d{5,30}@newsletter$/;

/** true si el JID es un canal de WhatsApp */
export function isNewsletterJid(jid) {
  return typeof jid === 'string' && NEWSLETTER_JID.test(jid.trim());
}

/**
 * Código de invitación de un canal, tal como aparece en whatsapp.com/channel/<code>.
 * Se valida aparte del JID porque es la única forma de descubrir un canal
 * al que la cuenta todavía no sigue.
 */
export function isNewsletterInvite(code) {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{5,64}$/.test(code.trim());
}

/**
 * Extrae el código de invitación de un enlace de canal, o null si no lo es.
 * Acepta el enlace completo o el código pelado, porque es lo que la gente copia.
 */
export function parseNewsletterInvite(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/);
  const code = fromUrl?.[1] ?? trimmed;
  return isNewsletterInvite(code) ? code : null;
}

// ── Validar número de teléfono ──────────────────────────────────
// allowNewsletter se activa solo donde publicar en un canal tiene sentido
// (enviar, foto de perfil). En check-number sigue rechazándose: un canal no
// es un número y onWhatsApp() no responde por él.
export function validatePhoneOrJid(to, { allowNewsletter = false } = {}) {
  const trimmed = to.trim();
  // Si tiene @, es un JID completo — aceptar formato grupo o individual
  if (trimmed.includes('@')) {
    if (allowNewsletter && isNewsletterJid(trimmed)) return true;
    return /^[\w.-]+@(s\.whatsapp\.net|g\.us)$/.test(trimmed);
  }
  // Solo número: limpiar formato y validar entre 7 y 15 dígitos (E.164 sin +)
  const cleaned = trimmed.replace(/[\s+()-]/g, '');
  return /^\d{7,15}$/.test(cleaned);
}

// ── Validar nombre de instancia (prevenir path traversal) ───────
export function validateInstanceName(req, res, next) {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    return res.status(400).json({ error: 'Nombre de instancia inválido. Solo letras, números, _ y - (máx 64 caracteres)' });
  }
  next();
}
