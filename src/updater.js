import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dependencias críticas a monitorear
const WATCHED_DEPS = [
  '@whiskeysockets/baileys',
  'express',
  'better-sqlite3',
];

// Las comprobaciones salen a internet (npm y GitHub). UPDATE_CHECK=false las
// desactiva por completo, para instalaciones que prefieren no llamar a casa.
const UPDATE_CHECK_ENABLED = process.env.UPDATE_CHECK !== 'false';

// La API de GitHub sin token permite 60 llamadas/hora por IP, así que el
// resultado se cachea y N cargas del panel no son N llamadas.
const RELEASE_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas
let releaseCache = null; // { checkedAt, latest, releaseUrl }

let pkgCache = null;
async function readPackageJson() {
  if (!pkgCache) {
    pkgCache = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8'));
  }
  return pkgCache;
}

/** Versión de WAME que está corriendo */
export async function getAppVersion() {
  try {
    return (await readPackageJson()).version ?? null;
  } catch {
    return null;
  }
}

/** Deriva "owner/repo" del campo repository de package.json */
async function getRepoSlug() {
  try {
    const url = (await readPackageJson()).repository?.url ?? '';
    const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

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
    const pkg = await readPackageJson();
    const versions = {};
    for (const dep of WATCHED_DEPS) {
      versions[dep] = pkg.dependencies?.[dep]?.replace(/^[\^~>=<]/, '') ?? null;
    }
    return versions;
  }
}

/** true si la versión es una prerelease (1.0.0-rc1, 2.0.0-beta.3, ...) */
function isPrerelease(version) {
  return typeof version === 'string' && version.includes('-');
}

/**
 * Compara versiones semver simples: retorna true si latest > installed.
 * Las prereleases nunca cuentan como actualización: recomendar saltar a una
 * release candidate en un gateway en producción es justo lo que no se quiere.
 */
export function isNewer(installed, latest) {
  if (!installed || !latest) return false;
  if (isPrerelease(latest)) return false;

  const a = String(installed).split('-')[0].split('.').map(Number);
  const b = String(latest).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (Number.isNaN(ai) || Number.isNaN(bi)) return false;
    if (bi > ai) return true;
    if (bi < ai) return false;
  }
  // Igual núcleo: una instalada en prerelease es anterior a la final
  return isPrerelease(installed);
}

/**
 * Última release publicada en GitHub. Cacheada en memoria; devuelve null si
 * está desactivado o si no se pudo consultar (fallo silencioso a propósito:
 * el panel debe funcionar igual sin conexión a internet).
 */
async function fetchLatestRelease() {
  const now = Date.now();
  if (releaseCache && now - releaseCache.checkedAt < RELEASE_CACHE_TTL) {
    return releaseCache;
  }

  const slug = await getRepoSlug();
  if (!slug) return null;

  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      redirect: 'follow', // el repo pudo haberse renombrado
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return releaseCache; // rate limit o red caída: conservar lo anterior
    const data = await res.json();
    if (data.prerelease) return releaseCache;

    releaseCache = {
      checkedAt: now,
      latest: (data.tag_name ?? '').replace(/^v/, '') || null,
      releaseUrl: data.html_url ?? null,
    };
    return releaseCache;
  } catch {
    return releaseCache;
  }
}

/**
 * Estado de actualización de WAME, para el panel.
 * Nunca lanza: si algo falla, informa la versión actual y nada más.
 */
export async function getUpdateStatus() {
  const current = await getAppVersion();
  const base = { current, latest: null, updateAvailable: false, releaseUrl: null, enabled: UPDATE_CHECK_ENABLED };
  if (!UPDATE_CHECK_ENABLED) return base;

  const release = await fetchLatestRelease();
  if (!release?.latest) return base;

  return {
    ...base,
    latest: release.latest,
    updateAvailable: isNewer(current, release.latest),
    releaseUrl: release.releaseUrl,
  };
}

/**
 * Verifica actualizaciones al iniciar la app.
 * No bloquea el arranque — solo muestra avisos en consola.
 */
export async function checkUpdates() {
  if (!UPDATE_CHECK_ENABLED) {
    console.log('[updater] Comprobación de actualizaciones desactivada (UPDATE_CHECK=false)');
    return;
  }

  console.log('[updater] Verificando actualizaciones...');

  // Versión de WAME
  try {
    const status = await getUpdateStatus();
    if (status.updateAvailable) {
      console.log(`[updater] ⚠ WAME: instalada ${status.current} → disponible ${status.latest}`);
      console.log(`[updater] Actualiza con "docker compose pull && docker compose up -d" — ${status.releaseUrl}`);
    } else if (status.current) {
      console.log(`[updater] WAME ${status.current} está al día.`);
    }
  } catch (err) {
    console.warn('[updater] No se pudo verificar la versión de WAME:', err.message);
  }

  // Dependencias
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
