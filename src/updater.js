import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dependencias críticas a monitorear
const WATCHED_DEPS = [
  '@whiskeysockets/baileys',
  'express',
  '@supabase/supabase-js',
];

/**
 * Consulta la versión más reciente de un paquete en npm
 */
async function fetchLatestVersion(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.version ?? null;
}

/**
 * Parsea la versión instalada desde package-lock.json (más preciso que el rango de package.json)
 */
async function getInstalledVersions() {
  try {
    const lockPath = join(__dirname, '..', 'package-lock.json');
    const lockfile = JSON.parse(await readFile(lockPath, 'utf8'));
    const versions = {};
    for (const dep of WATCHED_DEPS) {
      const entry = lockfile.packages?.[`node_modules/${dep}`];
      if (entry) versions[dep] = entry.version;
    }
    return versions;
  } catch {
    // Fallback: leer rangos de package.json
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    const versions = {};
    for (const dep of WATCHED_DEPS) {
      versions[dep] = pkg.dependencies?.[dep]?.replace(/^[\^~>=<]/, '') ?? null;
    }
    return versions;
  }
}

/**
 * Compara versiones semver simples: retorna true si latest > installed
 */
function isNewer(installed, latest) {
  if (!installed || !latest) return false;
  const a = installed.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Verifica actualizaciones al iniciar la app.
 * No bloquea el arranque — solo muestra avisos en consola.
 */
export async function checkUpdates() {
  console.log('[updater] Verificando actualizaciones de dependencias...');

  try {
    const installed = await getInstalledVersions();
    const results = await Promise.allSettled(
      WATCHED_DEPS.map(async (dep) => {
        const latest = await fetchLatestVersion(dep);
        return { dep, installed: installed[dep], latest };
      })
    );

    let hasUpdates = false;
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { dep, installed: inst, latest } = result.value;

      if (latest && inst && isNewer(inst, latest)) {
        hasUpdates = true;
        console.log(`[updater] ⚠ ${dep}: instalada ${inst} → disponible ${latest}`);
      }
    }

    if (!hasUpdates) {
      console.log('[updater] Todas las dependencias están actualizadas.');
    } else {
      console.log('[updater] Ejecuta "npm update" o revisa los changelogs antes de actualizar.');
    }
  } catch (err) {
    console.warn('[updater] No se pudieron verificar actualizaciones:', err.message);
  }
}
