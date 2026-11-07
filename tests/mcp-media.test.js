import { describe, it, expect } from 'vitest';
import { checkMediaUrl, assertPublicHttpUrl, isPublicAddress, MEDIA_LIMITS } from '../src/mcp/media.js';
import { isAllowedRedirectUri } from '../src/mcp/provider.js';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const head = (status, headers = {}) => async () => new Response(null, { status, headers });

describe('isPublicAddress', () => {
  it.each(['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::10.0.0.1'])(
    'bloquea %s', ip => expect(isPublicAddress(ip)).toBe(false));
  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('permite %s', ip => expect(isPublicAddress(ip)).toBe(true));
});

describe('assertPublicHttpUrl', () => {
  it('rechaza esquemas, credenciales y puertos no estándar', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd', publicDns)).rejects.toThrow(/http/);
    await expect(assertPublicHttpUrl('ftp://example.com/a', publicDns)).rejects.toThrow(/http/);
    await expect(assertPublicHttpUrl('https://u:p@example.com/a', publicDns)).rejects.toThrow(/usuario/);
    await expect(assertPublicHttpUrl('https://example.com:8080/a', publicDns)).rejects.toThrow(/puertos/);
  });
  it('rechaza hosts que resuelven a redes privadas', async () => {
    const internal = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }];
    await expect(assertPublicHttpUrl('https://mixto.example/a', internal)).rejects.toThrow(/privada/);
    await expect(assertPublicHttpUrl('https://nada.example/a', async () => [])).rejects.toThrow(/resolver/);
  });
});

describe('checkMediaUrl', () => {
  it('acepta un adjunto público del tipo y tamaño correctos', async () => {
    const r = await checkMediaUrl('https://cdn.example/foto.jpg', 'image', {
      resolve: publicDns, fetchImpl: head(200, { 'content-type': 'image/jpeg', 'content-length': '2048' }),
    });
    expect(r).toEqual({ url: 'https://cdn.example/foto.jpg', contentType: 'image/jpeg', size: 2048 });
  });

  it('rechaza tamaño excesivo y tipo distinto', async () => {
    const big = String(MEDIA_LIMITS.image.maxBytes + 1);
    await expect(checkMediaUrl('https://cdn.example/a.jpg', 'image', { resolve: publicDns, fetchImpl: head(200, { 'content-type': 'image/png', 'content-length': big }) }))
      .rejects.toThrow(/máximo/);
    await expect(checkMediaUrl('https://cdn.example/a.jpg', 'image', { resolve: publicDns, fetchImpl: head(200, { 'content-type': 'text/html' }) }))
      .rejects.toThrow(/text\/html/);
    await expect(checkMediaUrl('https://cdn.example/a.jpg', 'image', { resolve: publicDns, fetchImpl: head(404) }))
      .rejects.toThrow(/404/);
  });

  it('valida cada redirección y devuelve la URL final', async () => {
    const hops = {
      'https://a.example/x': new Response(null, { status: 302, headers: { location: 'https://b.example/y.mp4' } }),
      'https://b.example/y.mp4': new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    };
    const r = await checkMediaUrl('https://a.example/x', 'video', { resolve: publicDns, fetchImpl: async url => hops[url] });
    expect(r.url).toBe('https://b.example/y.mp4');

    const toInternal = async () => new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest' } });
    await expect(checkMediaUrl('https://a.example/x', 'image', { resolve: publicDns, fetchImpl: toInternal })).rejects.toThrow(/privada/);

    const loop = async url => new Response(null, { status: 302, headers: { location: url + '1' } });
    await expect(checkMediaUrl('https://a.example/x', 'image', { resolve: publicDns, fetchImpl: loop })).rejects.toThrow(/redirecciones/);
  });
});

describe('isAllowedRedirectUri', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://localhost:33418/callback', true],
    ['http://127.0.0.1:8080/cb', true],
    ['cursor://anysphere.cursor-mcp/oauth/callback', true],
    ['http://evil.example/cb', false],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['https://ok.example/cb#x', false],
    ['https://u:p@ok.example/cb', false],
    ['no es url', false],
  ])('%s → %s', (uri, expected) => expect(isAllowedRedirectUri(uri)).toBe(expected));
});
