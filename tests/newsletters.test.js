import { describe, it, expect, vi } from 'vitest';
import { isNewsletterJid, isNewsletterInvite, parseNewsletterInvite, validatePhoneOrJid } from '../src/utils/jid.js';
import { canPublish, normalizeMetadata, fetchNewsletter } from '../src/newsletters.js';
import { sendMessage } from '../src/sender.js';

const CHANNEL = '120363099999999999@newsletter';

describe('isNewsletterJid', () => {
  it('accepts a channel JID', () => {
    expect(isNewsletterJid(CHANNEL)).toBe(true);
  });

  it('rejects individual and group JIDs', () => {
    expect(isNewsletterJid('5491155551234@s.whatsapp.net')).toBe(false);
    expect(isNewsletterJid('120363012345678901@g.us')).toBe(false);
  });

  it('rejects a non-numeric channel id', () => {
    expect(isNewsletterJid('../etc/passwd@newsletter')).toBe(false);
    expect(isNewsletterJid('abc@newsletter')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isNewsletterJid(undefined)).toBe(false);
    expect(isNewsletterJid(12345)).toBe(false);
  });
});

describe('parseNewsletterInvite', () => {
  it('extracts the code from a full channel link', () => {
    expect(parseNewsletterInvite('https://whatsapp.com/channel/0029VaAbCdEfGhIjKl')).toBe('0029VaAbCdEfGhIjKl');
  });

  it('accepts the bare code', () => {
    expect(parseNewsletterInvite('0029VaAbCdEfGhIjKl')).toBe('0029VaAbCdEfGhIjKl');
  });

  it('rejects unrelated URLs and junk', () => {
    expect(parseNewsletterInvite('https://example.com/x')).toBe(null);
    expect(parseNewsletterInvite('ab')).toBe(null);
    expect(parseNewsletterInvite(null)).toBe(null);
  });
});

describe('isNewsletterInvite', () => {
  it('rejects codes with characters outside the invite alphabet', () => {
    expect(isNewsletterInvite('0029Va/../etc')).toBe(false);
    expect(isNewsletterInvite('0029VaAbCd')).toBe(true);
  });
});

// Los canales solo se aceptan donde publicar tiene sentido. En check-number
// se sigue rechazando: un canal no es un número.
describe('validatePhoneOrJid with allowNewsletter', () => {
  it('rejects channel JIDs by default', () => {
    expect(validatePhoneOrJid(CHANNEL)).toBe(false);
  });

  it('accepts channel JIDs when opted in', () => {
    expect(validatePhoneOrJid(CHANNEL, { allowNewsletter: true })).toBe(true);
  });

  it('still rejects malformed channel JIDs when opted in', () => {
    expect(validatePhoneOrJid('abc@newsletter', { allowNewsletter: true })).toBe(false);
  });

  it('keeps accepting phones and groups when opted in', () => {
    expect(validatePhoneOrJid('5491155551234', { allowNewsletter: true })).toBe(true);
    expect(validatePhoneOrJid('120363012345678901@g.us', { allowNewsletter: true })).toBe(true);
  });
});

describe('canPublish', () => {
  it('allows admins and owners', () => {
    expect(canPublish('ADMIN')).toBe(true);
    expect(canPublish('OWNER')).toBe(true);
    expect(canPublish('owner')).toBe(true);
  });

  it('denies subscribers, guests and unknown roles', () => {
    expect(canPublish('SUBSCRIBER')).toBe(false);
    expect(canPublish('GUEST')).toBe(false);
    expect(canPublish(null)).toBe(false);
    expect(canPublish(undefined)).toBe(false);
  });
});

describe('normalizeMetadata', () => {
  it('reads the flat shape Baileys documents', () => {
    expect(normalizeMetadata({
      id: CHANNEL,
      name: 'Avisos',
      description: 'Canal de avisos',
      invite: '0029VaAbCdEfGhIjKl',
      subscribers: 42,
      verification: 'VERIFIED',
      mute_state: 'OFF',
      creation_time: 1700000000,
      viewer_metadata: { role: 'OWNER', mute: 'OFF' },
    })).toEqual({
      jid: CHANNEL,
      name: 'Avisos',
      description: 'Canal de avisos',
      invite: '0029VaAbCdEfGhIjKl',
      subscribers: 42,
      verification: 'VERIFIED',
      role: 'OWNER',
      muted: false,
      createdAt: 1700000000,
    });
  });

  // La respuesta cruda de WhatsApp mete el nombre y la descripción dentro de
  // thread_metadata y como objetos {text}, no como strings.
  it('reads the nested thread_metadata shape', () => {
    const meta = normalizeMetadata({
      id: CHANNEL,
      thread_metadata: {
        name: { text: 'Avisos' },
        description: { text: 'Canal de avisos' },
        invite: '0029VaAbCdEfGhIjKl',
        subscribers_count: '42',
        verification: 'UNVERIFIED',
        creation_time: '1700000000',
      },
      viewer_metadata: { role: 'ADMIN', mute: 'ON' },
    });

    expect(meta.name).toBe('Avisos');
    expect(meta.description).toBe('Canal de avisos');
    expect(meta.subscribers).toBe(42);
    expect(meta.role).toBe('ADMIN');
    expect(meta.muted).toBe(true);
    expect(meta.createdAt).toBe(1700000000);
  });

  it('returns null when there is no id', () => {
    expect(normalizeMetadata({})).toBe(null);
    expect(normalizeMetadata(null)).toBe(null);
  });

  it('leaves subscribers null when WhatsApp omits it', () => {
    expect(normalizeMetadata({ id: CHANNEL, name: 'X' }).subscribers).toBe(null);
  });
});

describe('fetchNewsletter', () => {
  it('queries by jid when given a jid', async () => {
    const sock = { newsletterMetadata: vi.fn().mockResolvedValue({ id: CHANNEL, name: 'Avisos' }) };
    const meta = await fetchNewsletter(sock, { jid: CHANNEL });

    expect(sock.newsletterMetadata).toHaveBeenCalledWith('jid', CHANNEL);
    expect(meta.jid).toBe(CHANNEL);
  });

  it('queries by invite when given an invite code', async () => {
    const sock = { newsletterMetadata: vi.fn().mockResolvedValue({ id: CHANNEL, name: 'Avisos' }) };
    await fetchNewsletter(sock, { invite: '0029VaAbCdEfGhIjKl' });

    expect(sock.newsletterMetadata).toHaveBeenCalledWith('invite', '0029VaAbCdEfGhIjKl');
  });

  it('returns null when the channel is not visible', async () => {
    const sock = { newsletterMetadata: vi.fn().mockResolvedValue(null) };
    expect(await fetchNewsletter(sock, { jid: CHANNEL })).toBe(null);
  });
});

// Publicar en un canal no necesita una rama propia en sender.js: Baileys mira
// el servidor del JID y usa su rama de canal (plaintext + media sin cifrar).
describe('sendMessage to a channel', () => {
  it('sends text through the ordinary sendMessage path', async () => {
    const sock = { sendMessage: vi.fn().mockResolvedValue({ key: { id: 'm1' } }) };
    await sendMessage(sock, CHANNEL, 'text', { text: 'Aviso' });

    expect(sock.sendMessage).toHaveBeenCalledWith(CHANNEL, { text: 'Aviso' });
  });

  it('still rejects unsupported types', async () => {
    const sock = { sendMessage: vi.fn() };
    await expect(sendMessage(sock, CHANNEL, 'sticker', {})).rejects.toThrow(/no soportado/);
    expect(sock.sendMessage).not.toHaveBeenCalled();
  });
});
