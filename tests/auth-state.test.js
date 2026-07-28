import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// DATA_DIR debe estar puesto antes de que db.js se importe
const TMP = mkdtempSync(join(tmpdir(), 'wame-auth-'));
process.env.DATA_DIR = TMP;

const { useSQLiteAuthState, clearAuthState, listStoredInstances } = await import('../src/auth-state.js');
const { BufferJSON, initAuthCreds } = await import('@whiskeysockets/baileys');

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('useSQLiteAuthState', () => {
  it('creates fresh creds for a new instance', async () => {
    const { state } = await useSQLiteAuthState('nueva', join(TMP, 'no-existe'));
    expect(state.creds.registered).toBe(false);
    expect(Buffer.isBuffer(state.creds.noiseKey.private)).toBe(true);
  });

  it('persists creds across reloads', async () => {
    const a = await useSQLiteAuthState('persistente', join(TMP, 'nada'));
    a.state.creds.me = { id: '5215550001111:1@s.whatsapp.net', name: 'Prueba' };
    await a.saveCreds();

    const b = await useSQLiteAuthState('persistente', join(TMP, 'nada'));
    expect(b.state.creds.me.name).toBe('Prueba');
    // los Buffer deben sobrevivir el round-trip, no volverse objetos planos
    expect(Buffer.isBuffer(b.state.creds.noiseKey.private)).toBe(true);
    expect(b.state.creds.noiseKey.private.equals(a.state.creds.noiseKey.private)).toBe(true);
  });

  it('stores, reads back and deletes signal keys', async () => {
    const { state } = await useSQLiteAuthState('claves', join(TMP, 'nada'));
    const buf = Buffer.from([1, 2, 3, 4]);

    await state.keys.set({ 'pre-key': { 42: { public: buf, private: buf } } });
    let got = await state.keys.get('pre-key', ['42']);
    expect(Buffer.isBuffer(got['42'].public)).toBe(true);
    expect(got['42'].public.equals(buf)).toBe(true);

    // null = borrar (así lo usa Baileys al invalidar sender-key-memory)
    await state.keys.set({ 'pre-key': { 42: null } });
    got = await state.keys.get('pre-key', ['42']);
    expect(got['42']).toBeNull();
  });

  it('returns null for missing keys', async () => {
    const { state } = await useSQLiteAuthState('vacia', join(TMP, 'nada'));
    const got = await state.keys.get('session', ['no-existe']);
    expect(got['no-existe']).toBeNull();
  });

  it('isolates keys between instances', async () => {
    const a = await useSQLiteAuthState('inst-a', join(TMP, 'nada'));
    const b = await useSQLiteAuthState('inst-b', join(TMP, 'nada'));
    await a.state.keys.set({ 'pre-key': { 1: { public: Buffer.from([9]) } } });

    expect((await b.state.keys.get('pre-key', ['1']))['1']).toBeNull();
    expect((await a.state.keys.get('pre-key', ['1']))['1']).not.toBeNull();
  });

  it('normalizes ids with / and : like the file store did', async () => {
    const { state } = await useSQLiteAuthState('jids', join(TMP, 'nada'));
    const id = '5215550001111:12@s.whatsapp.net';
    await state.keys.set({ session: { [id]: { rec: Buffer.from([7]) } } });
    const got = await state.keys.get('session', [id]);
    expect(got[id].rec.equals(Buffer.from([7]))).toBe(true);
  });

  it('migrates an existing file-based session without re-scanning the QR', async () => {
    const dir = join(TMP, 'sesion-vieja');
    mkdirSync(dir, { recursive: true });
    const creds = initAuthCreds();
    creds.me = { id: '5215559998888:3@s.whatsapp.net', name: 'Migrado' };
    writeFileSync(join(dir, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer));
    writeFileSync(
      join(dir, 'pre-key-7.json'),
      JSON.stringify({ public: Buffer.from([5, 6]) }, BufferJSON.replacer)
    );

    const { state } = await useSQLiteAuthState('migrada', dir);
    expect(state.creds.me.name).toBe('Migrado');
    expect(Buffer.isBuffer(state.creds.noiseKey.private)).toBe(true);
    const got = await state.keys.get('pre-key', ['7']);
    expect(got['7'].public.equals(Buffer.from([5, 6]))).toBe(true);
  });

  it('does not re-migrate over newer data', async () => {
    const dir = join(TMP, 'sesion-vieja2');
    mkdirSync(dir, { recursive: true });
    const creds = initAuthCreds();
    creds.me = { id: 'x@s.whatsapp.net', name: 'DeArchivo' };
    writeFileSync(join(dir, 'creds.json'), JSON.stringify(creds, BufferJSON.replacer));

    const a = await useSQLiteAuthState('doble', dir);
    expect(a.state.creds.me.name).toBe('DeArchivo');
    a.state.creds.me = { id: 'x@s.whatsapp.net', name: 'MasNuevo' };
    await a.saveCreds();

    // segunda carga: debe ganar SQLite, no el archivo viejo
    const b = await useSQLiteAuthState('doble', dir);
    expect(b.state.creds.me.name).toBe('MasNuevo');
  });

  it('logs loudly instead of silently dropping a corrupt key', async () => {
    const dir = join(TMP, 'corrupta');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'creds.json'), JSON.stringify(initAuthCreds(), BufferJSON.replacer));
    writeFileSync(join(dir, 'pre-key-9.json'), '{"public":{"type":"Buff');  // truncado

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { state } = await useSQLiteAuthState('rota', dir);
    await state.keys.get('pre-key', ['9']);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.flat().join(' ')).toMatch(/rota/);
    spy.mockRestore();
  });

  it('clears state on instance deletion', async () => {
    const { state } = await useSQLiteAuthState('borrable', join(TMP, 'nada'));
    await state.keys.set({ 'pre-key': { 1: { public: Buffer.from([1]) } } });
    expect(listStoredInstances()).toContain('borrable');

    clearAuthState('borrable');
    expect(listStoredInstances()).not.toContain('borrable');
  });
});
