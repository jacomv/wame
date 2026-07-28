import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';
import { sendMessage } from '../src/sender.js';

function createMockSocket() {
  return { sendMessage: vi.fn().mockResolvedValue({ key: { id: 'msg-123' } }) };
}

/** Evita salir a la red: sirve una imagen real generada al vuelo */
async function mockImageFetch() {
  const png = await sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-length': String(png.length) }),
    arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('sendMessage', () => {
  it('sends a text message', async () => {
    const sock = createMockSocket();
    await sendMessage(sock, '5491155551234@s.whatsapp.net', 'text', { text: 'Hola' });

    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5491155551234@s.whatsapp.net',
      { text: 'Hola' },
    );
  });

  // Desde 1.0.2 la imagen se descarga y se reconvierte a JPEG en el servidor,
  // para que Baileys pueda generar el thumbnail y las dimensiones del preview.
  it('downloads the image and sends it as a JPEG buffer with caption', async () => {
    await mockImageFetch();
    const sock = createMockSocket();
    await sendMessage(sock, '5491155551234@s.whatsapp.net', 'image', {
      url: 'https://example.com/img.png',
      caption: 'Mi imagen',
    });

    expect(fetch).toHaveBeenCalledWith('https://example.com/img.png', expect.any(Object));
    const [jid, content] = sock.sendMessage.mock.calls[0];
    expect(jid).toBe('5491155551234@s.whatsapp.net');
    expect(content.caption).toBe('Mi imagen');
    expect(Buffer.isBuffer(content.image)).toBe(true);
    expect((await sharp(content.image).metadata()).format).toBe('jpeg');
  });

  it('passes through a caller-supplied thumbnail without re-encoding', async () => {
    const sock = createMockSocket();
    const thumb = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer();

    await sendMessage(sock, '5491155551234@s.whatsapp.net', 'image', {
      url: 'https://example.com/img.png',
      jpegThumbnail: thumb.toString('base64'),
      width: 640,
      height: 480,
    });

    const [, content] = sock.sendMessage.mock.calls[0];
    expect(content.image).toEqual({ url: 'https://example.com/img.png' });
    expect(content.width).toBe(640);
    expect(content.height).toBe(480);
    expect(content.jpegThumbnail.equals(thumb)).toBe(true);
  });

  it('rejects a thumbnail that is not a valid JPEG', async () => {
    const sock = createMockSocket();
    await expect(
      sendMessage(sock, '5491155551234@s.whatsapp.net', 'image', {
        url: 'https://example.com/img.png',
        jpegThumbnail: Buffer.from('no soy un jpeg').toString('base64'),
        width: 10,
        height: 10,
      }),
    ).rejects.toThrow('jpegThumbnail debe ser un JPEG válido');
  });

  it('sends an audio message as voice note', async () => {
    const sock = createMockSocket();
    await sendMessage(sock, '5491155551234@s.whatsapp.net', 'audio', {
      url: 'https://example.com/audio.mp3',
      ptt: true,
    });

    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5491155551234@s.whatsapp.net',
      { audio: { url: 'https://example.com/audio.mp3' }, mimetype: 'audio/mpeg', ptt: true },
    );
  });

  it('sends a document message', async () => {
    const sock = createMockSocket();
    await sendMessage(sock, '5491155551234@s.whatsapp.net', 'document', {
      url: 'https://example.com/doc.pdf',
      filename: 'reporte.pdf',
      mimetype: 'application/pdf',
    });

    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5491155551234@s.whatsapp.net',
      {
        document: { url: 'https://example.com/doc.pdf' },
        mimetype: 'application/pdf',
        fileName: 'reporte.pdf',
      },
    );
  });

  it('rejects unsupported message types', async () => {
    const sock = createMockSocket();
    await expect(
      sendMessage(sock, '5491155551234@s.whatsapp.net', 'video', { url: 'https://example.com/v.mp4' }),
    ).rejects.toThrow('Tipo de mensaje no soportado: video');
  });

  it('rejects text messages without text field', async () => {
    const sock = createMockSocket();
    await expect(
      sendMessage(sock, '5491155551234@s.whatsapp.net', 'text', {}),
    ).rejects.toThrow('Campo "text" requerido');
  });

  it('rejects media messages with non-HTTP URLs', async () => {
    const sock = createMockSocket();
    await expect(
      sendMessage(sock, '5491155551234@s.whatsapp.net', 'image', { url: 'file:///etc/passwd' }),
    ).rejects.toThrow('Solo se permiten URLs HTTP/HTTPS');
  });

  it('rejects media messages without URL', async () => {
    const sock = createMockSocket();
    await expect(
      sendMessage(sock, '5491155551234@s.whatsapp.net', 'image', {}),
    ).rejects.toThrow('URL de media requerida');
  });
});
