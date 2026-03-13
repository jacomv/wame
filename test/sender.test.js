import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../src/sender.js';

// Minimal mock — records the last call for inspection
const mockSock = {
  lastCall: null,
  async sendMessage(jid, content) {
    this.lastCall = { jid, content };
    return { status: 1 };
  },
};

// ── Type validation ──────────────────────────────────────────────

test('sendMessage: rejects unsupported message type', async () => {
  await assert.rejects(
    () => sendMessage(mockSock, 'jid', 'sticker', {}),
    /no soportado/
  );
});

// ── Text ─────────────────────────────────────────────────────────

test('sendMessage: sends text message', async () => {
  await sendMessage(mockSock, '521234@s.whatsapp.net', 'text', { text: 'Hello' });
  assert.equal(mockSock.lastCall.content.text, 'Hello');
});

test('sendMessage: rejects text without text field', async () => {
  await assert.rejects(
    () => sendMessage(mockSock, '521234@s.whatsapp.net', 'text', {}),
    /text/
  );
});

// ── Media URL validation ─────────────────────────────────────────

test('sendMessage: rejects file:// URL (SSRF prevention)', async () => {
  await assert.rejects(
    () => sendMessage(mockSock, '521234@s.whatsapp.net', 'image', { url: 'file:///etc/passwd' }),
    /HTTP\/HTTPS/
  );
});

test('sendMessage: rejects missing URL for image', async () => {
  await assert.rejects(
    () => sendMessage(mockSock, '521234@s.whatsapp.net', 'image', {}),
    /URL/
  );
});

test('sendMessage: sends image with valid https URL', async () => {
  await sendMessage(mockSock, '521234@s.whatsapp.net', 'image', {
    url: 'https://example.com/photo.jpg',
    caption: 'A photo',
  });
  assert.equal(mockSock.lastCall.content.caption, 'A photo');
});

test('sendMessage: sends audio as voice note when ptt=true', async () => {
  await sendMessage(mockSock, '521234@s.whatsapp.net', 'audio', {
    url: 'https://example.com/voice.ogg',
    ptt: true,
  });
  assert.equal(mockSock.lastCall.content.ptt, true);
});

test('sendMessage: sends document with filename and mimetype', async () => {
  await sendMessage(mockSock, '521234@s.whatsapp.net', 'document', {
    url: 'https://example.com/file.pdf',
    filename: 'report.pdf',
    mimetype: 'application/pdf',
  });
  assert.equal(mockSock.lastCall.content.fileName, 'report.pdf');
  assert.equal(mockSock.lastCall.content.mimetype, 'application/pdf');
});
