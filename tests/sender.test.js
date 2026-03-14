import { describe, it, expect, vi } from 'vitest';
import { sendMessage } from '../src/sender.js';

function createMockSocket() {
  return { sendMessage: vi.fn().mockResolvedValue({ key: { id: 'msg-123' } }) };
}

describe('sendMessage', () => {
  it('sends a text message', async () => {
    const sock = createMockSocket();
    await sendMessage(sock, '5491155551234@s.whatsapp.net', 'text', { text: 'Hola' });

    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5491155551234@s.whatsapp.net',
      { text: 'Hola' },
    );
  });

  it('sends an image message with caption', async () => {
    const sock = createMockSocket();
    await sendMessage(sock, '5491155551234@s.whatsapp.net', 'image', {
      url: 'https://example.com/img.png',
      caption: 'Mi imagen',
    });

    expect(sock.sendMessage).toHaveBeenCalledWith(
      '5491155551234@s.whatsapp.net',
      { image: { url: 'https://example.com/img.png' }, caption: 'Mi imagen' },
    );
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
