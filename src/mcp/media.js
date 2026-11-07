// Validación de URLs de multimedia que llegan por MCP. Un agente puede recibir
// texto de terceros (prompt injection), así que aquí se exige más que en la API
// REST: solo destinos públicos, puertos estándar, redirecciones validadas una a
// una y tamaño/tipo comprobados con HEAD antes de que Baileys descargue nada.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const MB = 1024 * 1024;
export const MEDIA_LIMITS = {
  image: { maxBytes: 16 * MB, mime: /^image\// },
  video: { maxBytes: 64 * MB, mime: /^video\// },
  audio: { maxBytes: 16 * MB, mime: /^audio\// },
  document: { maxBytes: 100 * MB, mime: /^[\w.+-]+\/[\w.+-]+$/ },
};
const MAX_REDIRECTS = 3;
const HEAD_TIMEOUT_MS = 8000;

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  // Sin ::ffff:0:0/96 ni 64:ff9b::/96: BlockList también los aplica a las IPv4
  // y bloquearía todo. Las IPv4 mapeadas se comprueban aparte, extrayendo la IPv4.
  ['::', 128], ['::1', 128], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked.addSubnet(net, prefix, 'ipv6');

export class MediaUrlError extends Error {}

/** IPv4 contenida en una IPv6 mapeada (::ffff:a.b.c.d o ::ffff:7f00:1), o null. */
function embeddedIPv4(address) {
  const m = address.toLowerCase().match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/) || address.toLowerCase().match(/^64:ff9b::(.+)$/);
  if (!m) return null;
  const rest = m[1];
  if (isIP(rest) === 4) return rest;
  const groups = rest.split(':');
  if (groups.length !== 2 || !groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const [hi, lo] = groups.map(g => parseInt(g, 16));
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6) {
    const v4 = embeddedIPv4(address);
    if (v4) return isPublicAddress(v4);
  }
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Comprueba forma, puerto y que el host resuelva solo a direcciones públicas. */
export async function assertPublicHttpUrl(value, resolve = lookup) {
  let url;
  try { url = new URL(value); } catch { throw new MediaUrlError('URL inválida'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new MediaUrlError('Solo se permiten URLs http o https');
  if (url.username || url.password) throw new MediaUrlError('La URL no puede llevar usuario ni contraseña');
  if (url.port && !['80', '443'].includes(url.port)) throw new MediaUrlError('Solo se permiten los puertos 80 y 443');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await resolve(host, { all: true, verbatim: true }).catch(() => [])).map(a => a.address);
  if (!addresses.length) throw new MediaUrlError('No se pudo resolver el host de la URL');
  if (!addresses.every(isPublicAddress)) throw new MediaUrlError('La URL apunta a una red privada o reservada');
  return url;
}

/**
 * Valida la URL de un adjunto y devuelve la URL final (tras redirecciones), que
 * es la que se entrega a Baileys para que no vuelva a seguir saltos sin control.
 */
export async function checkMediaUrl(value, type, { fetchImpl = fetch, resolve = lookup } = {}) {
  const limits = MEDIA_LIMITS[type];
  if (!limits) throw new MediaUrlError(`Tipo de adjunto no soportado: ${type}`);

  let url = await assertPublicHttpUrl(value, resolve);
  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await fetchImpl(url.href, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
    } catch {
      throw new MediaUrlError('No se pudo verificar la URL del adjunto');
    }
    if (res.status >= 300 && res.status < 400) {
      if (hop >= MAX_REDIRECTS) throw new MediaUrlError('Demasiadas redirecciones');
      const location = res.headers.get('location');
      if (!location) throw new MediaUrlError('Redirección sin destino');
      url = await assertPublicHttpUrl(new URL(location, url).href, resolve);
      continue;
    }
    if (!res.ok) throw new MediaUrlError(`El adjunto no está disponible (HTTP ${res.status})`);

    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > limits.maxBytes) {
      throw new MediaUrlError(`El adjunto supera el máximo de ${limits.maxBytes / MB} MB para ${type}`);
    }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !limits.mime.test(contentType)) {
      throw new MediaUrlError(`El adjunto es ${contentType}, no ${type}`);
    }
    return { url: url.href, contentType: contentType || null, size: Number.isFinite(length) ? length : null };
  }
}
