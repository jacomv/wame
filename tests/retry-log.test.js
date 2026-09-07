import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyAddressing, recordRetry, clearRetryLog } from '../src/retry-log.js';

describe('classifyAddressing', () => {
  it('recognises phone-number addressing', () => {
    expect(classifyAddressing('573004211788@s.whatsapp.net')).toBe('PN');
    expect(classifyAddressing('573004211788@c.us')).toBe('PN');
  });

  // El caso a vigilar: 6.7.x no mapea LID↔PN.
  it('recognises LID addressing', () => {
    expect(classifyAddressing('123456789012345@lid')).toBe('LID');
    expect(classifyAddressing('573004211788:12@lid')).toBe('LID');
  });

  it('recognises groups and channels', () => {
    expect(classifyAddressing('120363012345678901@g.us')).toBe('GROUP');
    expect(classifyAddressing('120363099999999999@newsletter')).toBe('NEWSLETTER');
  });

  it('handles junk without throwing', () => {
    expect(classifyAddressing(undefined)).toBe('UNKNOWN');
    expect(classifyAddressing(null)).toBe('UNKNOWN');
    expect(classifyAddressing('nonsense')).toBe('OTHER');
  });
});

describe('recordRetry', () => {
  beforeEach(() => {
    clearRetryLog('inst');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const key = (over = {}) => ({
    id: 'MSG1',
    remoteJid: '573004211788@s.whatsapp.net',
    ...over,
  });

  it('counts attempts per message and target', () => {
    expect(recordRetry({ instance: 'inst', key: key(), cacheHit: true }).attempt).toBe(1);
    expect(recordRetry({ instance: 'inst', key: key(), cacheHit: true }).attempt).toBe(2);
    expect(recordRetry({ instance: 'inst', key: key(), cacheHit: true }).attempt).toBe(3);
  });

  it('counts separately per participant', () => {
    const a = { participant: '573004211788:1@s.whatsapp.net' };
    const b = { participant: '573004211788:2@s.whatsapp.net' };
    expect(recordRetry({ instance: 'inst', key: key(a), cacheHit: true }).attempt).toBe(1);
    expect(recordRetry({ instance: 'inst', key: key(b), cacheHit: true }).attempt).toBe(1);
    expect(recordRetry({ instance: 'inst', key: key(a), cacheHit: true }).attempt).toBe(2);
  });

  it('classifies by participant, not remoteJid, when both are present', () => {
    // En grupo, remoteJid es el grupo y participant es quien no descifró.
    const r = recordRetry({
      instance: 'inst',
      key: key({ remoteJid: '1203630@g.us', participant: '99999@lid' }),
      cacheHit: true,
    });
    expect(r.addressing).toBe('LID');
  });

  it('falls back to remoteJid when there is no participant', () => {
    expect(recordRetry({ instance: 'inst', key: key(), cacheHit: true }).addressing).toBe('PN');
  });

  // Un segundo intento significa que el reenvío anterior tampoco se descifró:
  // esa es la señal que antes no existía.
  it('warns from the second attempt onward, not the first', () => {
    recordRetry({ instance: 'inst', key: key(), cacheHit: true });
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();

    recordRetry({ instance: 'inst', key: key(), cacheHit: true });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('el reenvío anterior no se descifró'));
  });

  it('warns on a cache miss even on the first attempt', () => {
    recordRetry({ instance: 'inst', key: key(), cacheHit: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no está en caché'));
  });

  it('reports the log line with all diagnostic fields', () => {
    recordRetry({ instance: 'inst', key: key({ participant: '55555@lid' }), cacheHit: true });
    const line = console.log.mock.calls[0][0];
    expect(line).toContain('[retry] inst');
    expect(line).toContain('msg=MSG1');
    expect(line).toContain('attempt=1/5');
    expect(line).toContain('participant=55555@lid');
    expect(line).toContain('addressing=LID');
    expect(line).toContain('cache=HIT');
  });

  it('flags exhaustion at the Baileys retry ceiling', () => {
    let r;
    for (let i = 0; i < 5; i++) r = recordRetry({ instance: 'inst', key: key(), cacheHit: true });
    expect(r.exhausted).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('se agotaron los 5 reintentos'));
  });

  it('names LID as the probable cause when exhausting against a LID target', () => {
    for (let i = 0; i < 5; i++) {
      recordRetry({ instance: 'inst', key: key({ participant: '55555@lid' }), cacheHit: true });
    }
    const warned = console.warn.mock.calls.map((c) => c[0]).join('\n');
    expect(warned).toContain('no mapea LID↔PN');
  });

  it('does not name LID when the target is a phone number', () => {
    for (let i = 0; i < 5; i++) recordRetry({ instance: 'inst', key: key(), cacheHit: true });
    const warned = console.warn.mock.calls.map((c) => c[0]).join('\n');
    expect(warned).toContain('se agotaron los 5 reintentos');
    expect(warned).not.toContain('no mapea LID');
  });

  it('survives a malformed key', () => {
    const r = recordRetry({ instance: 'inst', key: {}, cacheHit: false });
    expect(r.attempt).toBe(1);
    expect(r.addressing).toBe('UNKNOWN');
  });

  it('clearRetryLog resets the counters of that instance only', () => {
    recordRetry({ instance: 'inst', key: key(), cacheHit: true });
    recordRetry({ instance: 'other', key: key(), cacheHit: true });
    clearRetryLog('inst');
    expect(recordRetry({ instance: 'inst', key: key(), cacheHit: true }).attempt).toBe(1);
    expect(recordRetry({ instance: 'other', key: key(), cacheHit: true }).attempt).toBe(2);
    clearRetryLog('other');
  });
});
