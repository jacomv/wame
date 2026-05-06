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

    case 'image': {
      validateMediaUrl(payload.url);
      const message = {
        image: { url: payload.url },
        caption: payload.caption ?? '',
      };
      if (payload.jpegThumbnail !== undefined && payload.jpegThumbnail !== null) {
        if (typeof payload.jpegThumbnail !== 'string') {
          throw new Error('jpegThumbnail debe ser un string base64');
        }
        const buf = Buffer.from(payload.jpegThumbnail, 'base64');
        if (buf.length === 0) {
          throw new Error('jpegThumbnail base64 inválido o vacío');
        }
        if (buf.length > 256 * 1024) {
          throw new Error('jpegThumbnail debe ser ≤ 256KB');
        }
        if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
          throw new Error('jpegThumbnail debe ser un JPEG válido (magic bytes FF D8 FF)');
        }
        message.jpegThumbnail = buf;
      }
      if (payload.width !== undefined) {
        if (!Number.isInteger(payload.width) || payload.width <= 0 || payload.width > 32768) {
          throw new Error('width debe ser un entero positivo ≤ 32768');
        }
        message.width = payload.width;
      }
      if (payload.height !== undefined) {
        if (!Number.isInteger(payload.height) || payload.height <= 0 || payload.height > 32768) {
          throw new Error('height debe ser un entero positivo ≤ 32768');
        }
        message.height = payload.height;
      }
      return sock.sendMessage(to, message);
    }

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
