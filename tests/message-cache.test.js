import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// DATA_DIR debe estar puesto antes de que db.js se importe
const TMP = mkdtempSync(join(tmpdir(), 'wame-msgcache-'));
process.env.DATA_DIR = TMP;

const { cacheMessage, getCachedMessage, clearMessageCache, purgeExpired } =
  await import('../src/message-cache.js');
const db = (await import('../src/db.js')).default;

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// Simula un reinicio del proceso: vacía la memoria dejando SQLite intacto.
function simulateRestart() {
  // El LRU en memoria tiene tope de 1000; desbordarlo lo deja sin las entradas
  // previas sin tocar el disco, que es justo lo que hace un reinicio.
  for (let i = 0; i < 1001; i++) {
    cacheMessage('__scratch__', `flush-${i}`, { conversation: 'x' });
  }
  db.prepare("DELETE FROM message_cache WHERE instance = '__scratch__'").run();
}

describe('message cache', () => {
  it('stores and retrieves a message', () => {
    cacheMessage('inst', 'ABC123', { conversation: 'hola' });
    expect(getCachedMessage('inst', 'ABC123').conversation).toBe('hola');
  });

  it('returns undefined for unknown ids', () => {
    expect(getCachedMessage('inst', 'NO-EXISTE')).toBeUndefined();
  });

  it('isolates messages between instances', () => {
    cacheMessage('inst-a', 'DUP', { conversation: 'de A' });
    expect(getCachedMessage('inst-b', 'DUP')).toBeUndefined();
  });

  it('survives a process restart via SQLite', () => {
    cacheMessage('inst', 'PERSISTE', { conversation: 'sigo aqui' });
    simulateRestart();
    expect(getCachedMessage('inst', 'PERSISTE').conversation).toBe('sigo aqui');
  });

  it('preserves Buffers through the SQLite round-trip', () => {
    // mediaKey y waveform son binarios; si se corrompen, el reenvío es inútil
    const audio = { audioMessage: {
      url: 'https://mmg.whatsapp.net/x.enc',
      mediaKey: Buffer.from([1, 2, 3, 4]),
      waveform: new Uint8Array([9, 8, 7]),
      seconds: 12,
    }};
    cacheMessage('inst', 'AUDIO', audio);
    simulateRestart();

    const got = getCachedMessage('inst', 'AUDIO');
    expect(Buffer.isBuffer(got.audioMessage.mediaKey)).toBe(true);
    expect(got.audioMessage.mediaKey.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(Buffer.from(got.audioMessage.waveform)).toEqual(Buffer.from([9, 8, 7]));
    expect(got.audioMessage.seconds).toBe(12);
  });

  it('evicts the least recently used beyond the memory cap but keeps it on disk', () => {
    cacheMessage('lru', 'VIEJO', { conversation: 'viejo' });
    for (let i = 0; i < 1001; i++) cacheMessage('lru', `relleno-${i}`, { conversation: `${i}` });
    // desalojado de memoria, pero SQLite lo recupera
    expect(getCachedMessage('lru', 'VIEJO').conversation).toBe('viejo');
  });

  it('does not return expired entries and purges them', () => {
    cacheMessage('inst', 'VENCIDO', { conversation: 'caducado' });
    db.prepare('UPDATE message_cache SET expires_at = ? WHERE msg_id = ?')
      .run(Date.now() - 1000, 'VENCIDO');
    simulateRestart();

    expect(getCachedMessage('inst', 'VENCIDO')).toBeUndefined();
    const row = db.prepare("SELECT COUNT(*) AS n FROM message_cache WHERE msg_id = 'VENCIDO'").get();
    expect(row.n).toBe(0);
  });

  it('purgeExpired removes only expired rows', () => {
    cacheMessage('purga', 'VIVO', { conversation: 'vivo' });
    cacheMessage('purga', 'MUERTO', { conversation: 'muerto' });
    db.prepare('UPDATE message_cache SET expires_at = ? WHERE msg_id = ?')
      .run(Date.now() - 1, 'MUERTO');

    expect(purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM message_cache WHERE msg_id = 'MUERTO'").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM message_cache WHERE msg_id = 'VIVO'").get().n).toBe(1);
  });

  it('clearMessageCache wipes one instance from memory and disk', () => {
    cacheMessage('borrame', 'X', { conversation: 'x' });
    cacheMessage('conservame', 'Y', { conversation: 'y' });

    clearMessageCache('borrame');

    expect(getCachedMessage('borrame', 'X')).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM message_cache WHERE instance = 'borrame'").get().n).toBe(0);
    expect(getCachedMessage('conservame', 'Y').conversation).toBe('y');
  });

  it('logs and drops a row it cannot parse', () => {
    cacheMessage('rota', 'MALA', { conversation: 'ok' });
    db.prepare('UPDATE message_cache SET message = ? WHERE msg_id = ?').run('{trunc', 'MALA');
    simulateRestart();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getCachedMessage('rota', 'MALA')).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    expect(db.prepare("SELECT COUNT(*) AS n FROM message_cache WHERE msg_id = 'MALA'").get().n).toBe(0);
  });
});
