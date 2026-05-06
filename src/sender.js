import sharp from 'sharp';

const ALLOWED_TYPES = new Set(['text', 'image', 'audio', 'document']);
const MAX_IMAGE_DOWNLOAD_BYTES = 16 * 1024 * 1024;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 15000;

async function fetchImageBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`No se pudo descargar la imagen (${res.status} ${res.statusText})`);
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`Imagen excede el tamaño máximo de ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_IMAGE_DOWNLOAD_BYTES) {
      throw new Error(`Imagen excede el tamaño máximo de ${MAX_IMAGE_DOWNLOAD_BYTES} bytes`);
    }
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

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

      const hasManualThumb = payload.jpegThumbnail !== undefined && payload.jpegThumbnail !== null;
      const hasManualWidth = payload.width !== undefined;
      const hasManualHeight = payload.height !== undefined;
      const fullyManual = hasManualThumb && hasManualWidth && hasManualHeight;

      if (hasManualThumb && typeof payload.jpegThumbnail !== 'string') {
        throw new Error('jpegThumbnail debe ser un string base64');
      }
      if (hasManualWidth && (!Number.isInteger(payload.width) || payload.width <= 0 || payload.width > 32768)) {
        throw new Error('width debe ser un entero positivo ≤ 32768');
      }
      if (hasManualHeight && (!Number.isInteger(payload.height) || payload.height <= 0 || payload.height > 32768)) {
        throw new Error('height debe ser un entero positivo ≤ 32768');
      }

      if (fullyManual) {
        const thumbBuf = Buffer.from(payload.jpegThumbnail, 'base64');
        if (thumbBuf.length === 0) {
          throw new Error('jpegThumbnail base64 inválido o vacío');
        }
        if (thumbBuf.length > 256 * 1024) {
          throw new Error('jpegThumbnail debe ser ≤ 256KB');
        }
        if (thumbBuf[0] !== 0xff || thumbBuf[1] !== 0xd8 || thumbBuf[2] !== 0xff) {
          throw new Error('jpegThumbnail debe ser un JPEG válido (magic bytes FF D8 FF)');
        }
        return sock.sendMessage(to, {
          image: { url: payload.url },
          caption: payload.caption ?? '',
          jpegThumbnail: thumbBuf,
          width: payload.width,
          height: payload.height,
        });
      }

      const sourceBuf = await fetchImageBuffer(payload.url);
      const jpegBuf = await sharp(sourceBuf).jpeg({ quality: 90 }).toBuffer();
      return sock.sendMessage(to, {
        image: jpegBuf,
        caption: payload.caption ?? '',
      });
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
