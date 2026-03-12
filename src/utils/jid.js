// ── Normalizar JID ──────────────────────────────────────────────
export function normalizeJid(to) {
  // Si ya es un JID completo (tiene @), solo limpiar espacios
  if (to.includes('@')) return to.trim();
  // Solo número: limpiar formato telefónico común
  const cleaned = to.replace(/[\s+()-]/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

// ── Validar número de teléfono ──────────────────────────────────
export function validatePhoneOrJid(to) {
  const trimmed = to.trim();
  // Si tiene @, es un JID completo — aceptar formato grupo o individual
  if (trimmed.includes('@')) {
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
