import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// UPDATE_CHECK=false debe quedar puesto antes de importar el módulo
process.env.UPDATE_CHECK = 'false';
const { isNewer, getAppVersion, getUpdateStatus } = await import('../src/updater.js');

describe('isNewer', () => {
  it('detects a newer stable version', () => {
    expect(isNewer('1.0.2', '1.1.0')).toBe(true);
    expect(isNewer('1.9.9', '2.0.0')).toBe(true);
    expect(isNewer('1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false for same or older versions', () => {
    expect(isNewer('1.1.0', '1.1.0')).toBe(false);
    expect(isNewer('2.0.0', '1.9.9')).toBe(false);
    expect(isNewer('1.0.1', '1.0.0')).toBe(false);
  });

  // El bug: 'x'.split('.') sobre 7.0.0-rc13 daba NaN y la comparación del
  // primer componente ya devolvía true, recomendando saltar a una RC.
  it('never treats a prerelease as an available update', () => {
    expect(isNewer('6.7.21', '7.0.0-rc13')).toBe(false);
    expect(isNewer('1.0.0', '2.0.0-beta.1')).toBe(false);
    expect(isNewer('1.0.0', '1.0.1-alpha')).toBe(false);
  });

  it('treats a stable release as newer than the prerelease of the same version', () => {
    expect(isNewer('2.0.0-rc1', '2.0.0')).toBe(true);
    expect(isNewer('2.0.0-rc1', '2.0.1')).toBe(true);
  });

  it('handles missing or malformed input without throwing', () => {
    expect(isNewer(null, '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', null)).toBe(false);
    expect(isNewer('no-semver', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', 'latest')).toBe(false);
  });

  it('compares versions with differing numbers of components', () => {
    expect(isNewer('1.0', '1.0.1')).toBe(true);
    expect(isNewer('1.0.1', '1.0')).toBe(false);
  });
});

describe('getAppVersion', () => {
  it('matches package.json', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(await getAppVersion()).toBe(pkg.version);
  });
});

describe('getUpdateStatus with UPDATE_CHECK=false', () => {
  it('reports the current version without calling out to the network', async () => {
    const status = await getUpdateStatus();
    expect(status.enabled).toBe(false);
    expect(status.current).toBeTruthy();
    expect(status.latest).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });
});
