import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import db from './db.js';

// Estado de autenticación (credenciales + claves Signal) en SQLite.
//
// Reemplaza a useMultiFileAuthState, que reescribe cada archivo con un
// writeFile sin tmp+rename ni fsync: si el proceso muere a mitad de escritura
// el JSON queda truncado, su lectura falla y Baileys lo interpreta como
// "la clave no existe". Resultado: la sesión Signal con ese contacto se pierde
// y todo lo que se le envíe queda en "Esperando el mensaje" para siempre.
//
// better-sqlite3 es síncrono y transaccional sobre WAL, así que una escritura
// interrumpida se revierte entera en vez de dejar datos a medias.
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_state (
    instance TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (instance, key)
  ) WITHOUT ROWID;
`);

const selectStmt = db.prepare('SELECT value FROM auth_state WHERE instance = ? AND key = ?');
const upsertStmt = db.prepare(
  `INSERT INTO auth_state (instance, key, value) VALUES (?, ?, ?)
   ON CONFLICT(instance, key) DO UPDATE SET value = excluded.value`
);
const deleteStmt = db.prepare('DELETE FROM auth_state WHERE instance = ? AND key = ?');
const deleteAllStmt = db.prepare('DELETE FROM auth_state WHERE instance = ?');
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM auth_state WHERE instance = ?');
const listStmt = db.prepare('SELECT DISTINCT instance FROM auth_state');

// Misma normalización que aplicaba useMultiFileAuthState a los nombres de
// archivo, para que las claves migradas coincidan con las que se consultan.
const sanitize = (key) => key.replace(/\//g, '__').replace(/:/g, '-');

function readKey(instance, rawKey) {
  const key = sanitize(rawKey);
  const row = selectStmt.get(instance, key);
  if (!row) return null;
  try {
    return JSON.parse(row.value, BufferJSON.reviver);
  } catch (err) {
    // No silenciar: una clave ilegible rompe el descifrado con ese contacto y
    // sin este log el síntoma es un mensaje atascado sin explicación.
    console.error(
      `[auth-state] ${instance}: clave "${key}" corrupta e ilegible (${err.message}). ` +
      `Los mensajes con ese contacto pueden quedar en "Esperando el mensaje".`
    );
    return null;
  }
}

const writeKeys = db.transaction((instance, entries) => {
  for (const [rawKey, value] of entries) {
    const key = sanitize(rawKey);
    if (value === null || value === undefined) {
      deleteStmt.run(instance, key);
    } else {
      upsertStmt.run(instance, key, JSON.stringify(value, BufferJSON.replacer));
    }
  }
});

/**
 * Importa una sesión en archivos (useMultiFileAuthState) a SQLite.
 * Solo corre si la instancia no tiene filas todavía, así que es idempotente y
 * evita que haya que volver a escanear el QR al actualizar.
 * Los archivos se conservan como respaldo.
 */
async function migrateFromFiles(instance, sessionPath) {
  if (countStmt.get(instance).n > 0) return;

  let files;
  try {
    files = (await readdir(sessionPath)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return; // Instancia nueva, nada que migrar
    throw err;
  }
  if (files.length === 0) return;

  const entries = [];
  let corrupt = 0;
  for (const file of files) {
    const raw = await readFile(path.join(sessionPath, file), 'utf-8');
    try {
      // El nombre de archivo ya viene normalizado por useMultiFileAuthState.
      entries.push([path.basename(file, '.json'), JSON.parse(raw, BufferJSON.reviver)]);
    } catch (err) {
      corrupt++;
      console.error(`[auth-state] ${instance}: se omite "${file}" al migrar, JSON inválido (${err.message})`);
    }
  }

  writeKeys(instance, entries);
  console.log(
    `[auth-state] ${instance}: migradas ${entries.length} claves de archivos a SQLite` +
    (corrupt > 0 ? ` (${corrupt} corruptas omitidas)` : '')
  );
}

/**
 * Equivalente a useMultiFileAuthState pero respaldado por SQLite.
 * @param {string} instance nombre de la instancia
 * @param {string} sessionPath carpeta de la sesión en archivos, para migrar
 */
export async function useSQLiteAuthState(instance, sessionPath) {
  await migrateFromFiles(instance, sessionPath);

  const creds = readKey(instance, 'creds') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = readKey(instance, `${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          const entries = [];
          for (const category in data) {
            for (const id in data[category]) {
              entries.push([`${category}-${id}`, data[category][id]]);
            }
          }
          writeKeys(instance, entries);
        },
      },
    },
    saveCreds: async () => {
      writeKeys(instance, [['creds', creds]]);
    },
  };
}

/** Borra el estado de autenticación de una instancia */
export function clearAuthState(instance) {
  deleteAllStmt.run(instance);
}

/** Nombres de instancias con estado guardado en SQLite */
export function listStoredInstances() {
  return listStmt.all().map((r) => r.instance);
}
