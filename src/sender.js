const ALLOWED_TYPES = new Set(['text', 'image', 'audio', 'document']);

/** Valida que una URL sea HTTP/HTTPS (previene SSRF con file://, etc.) */
function validateMediaUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL de media requerida');
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Solo se permiten URLs HTTP/HTTPS');
    }
  } catch (err) {
    if (err.message.includes('HTTP')) throw err;
    throw new Error(`URL inválida: ${url}`);
  }
}

export async function sendMessage(sock, to, type, payload) {
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`Tipo de mensaje no soportado: ${type}. Tipos válidos: ${[...ALLOWED_TYPES].join(', ')}`);
  }

  switch (type) {
    case 'text':
      if (!payload.text || typeof payload.text !== 'string') {
        throw new Error('Campo "text" requerido y debe ser un string');
      }
      return sock.sendMessage(to, { text: payload.text });

    case 'image':
      validateMediaUrl(payload.url);
      return sock.sendMessage(to, {
        image: { url: payload.url },
        caption: payload.caption ?? '',
      });

    case 'audio':
      validateMediaUrl(payload.url);
      return sock.sendMessage(to, {
        audio: { url: payload.url },
        mimetype: payload.mimetype ?? 'audio/mpeg',
        ptt: payload.ptt ?? false,
      });

    case 'document':
      validateMediaUrl(payload.url);
      return sock.sendMessage(to, {
        document: { url: payload.url },
        mimetype: payload.mimetype ?? 'application/octet-stream',
        fileName: payload.filename ?? 'archivo',
      });
  }
}
