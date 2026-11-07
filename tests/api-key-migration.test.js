import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'wame-key-migration-'));
process.env.DATA_DIR = dir;
const { default: db } = await import('../src/db.js');
db.prepare('INSERT INTO accounts (email, password_hash, api_key) VALUES (?, ?, ?)').run(
  'legacy@example.test', 'placeholder', 'legacy-integration-secret',
);
const { findByApiKey } = await import('../src/accounts.js');

describe('legacy API key migration', () => {
  afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

  it('retains the original secret while hashing its stored value', () => {
    expect(findByApiKey('legacy-integration-secret')?.email).toBe('legacy@example.test');
    const stored = db.prepare('SELECT api_key FROM accounts WHERE email = ?').get('legacy@example.test').api_key;
    expect(stored).not.toBe('legacy-integration-secret');
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });
});
