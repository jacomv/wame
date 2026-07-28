import { BufferJSON } from '@whiskeysockets/baileys';
import db from './db.js';

// Caché de mensajes enviados, para poder responder a los retry receipts
// (getMessage). Si el receptor no logra descifrar un mensaje pide que se lo
// reenviemos; sin el original a mano, se queda en "Esperando el mensaje".
//
// Dos niveles: un LRU en memoria como camino rápido y SQLite como respaldo,
// para que un reinicio del proceso o del contenedor no pierda los reintentos
// pendientes. Un mensaje de texto o de audio ocupa ~1,7 KB.
const TTL_HOURS = Number(process.env.MSG_CACHE_TTL_HOURS || 24);
const MSG_CACHE_TTL = TTL_HOURS * 60 * 60 * 1000;
const MSG_CACHE_MAX = 1000; // tope del LRU en memoria (SQLite se acota por TTL)
const PURGE_INTERVAL_MS = 10 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS message_cache (
    instance TEXT NOT NULL,
    msg_id TEXT NOT NULL,
    message TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (instance, msg_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS idx_message_cache_expires ON message_cache(expires_at);
`);

const upsertStmt = db.prepare(
  `INSERT INTO message_cache (instance, msg_id, message, expires_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(instance, msg_id) DO UPDATE SET message = excluded.message, expires_at = excluded.expires_at`
);
const selectStmt = db.prepare('SELECT message, expires_at FROM message_cache WHERE instance = ? AND msg_id = ?');
const deleteStmt = db.prepare('DELETE FROM message_cache WHERE instance = ? AND msg_id = ?');
const deleteInstanceStmt = db.prepare('DELETE FROM message_cache WHERE instance = ?');
const purgeStmt = db.prepare('DELETE FROM message_cache WHERE expires_at <= ?');

// LRU con expiración perezosa: Map conserva el orden de inserción, así que la
// primera clave es siempre la menos usada recientemente.
const memCache = new Map(); // `${instance}:${msgId}` → { message, expiresAt }

function memSet(key, entry) {
  memCache.delete(key); // reinsertar al final para marcarlo como reciente
  memCache.set(key, entry);
  while (memCache.size > MSG_CACHE_MAX) {
    memCache.delete(memCache.keys().next().value);
  }
}

export function cacheMessage(instance, msgId, message) {
  const expiresAt = Date.now() + MSG_CACHE_TTL;
  memSet(`${instance}:${msgId}`, { message, expiresAt });
  try {
    upsertStmt.run(instance, msgId, JSON.stringify(message, BufferJSON.replacer), expiresAt);
  } catch (err) {
    // El respaldo en disco es best-effort: si falla, la copia en memoria sigue
    // sirviendo mientras el proceso viva. Pero que quede en el log.
    console.error(`[message-cache] ${instance}: no se pudo persistir ${msgId} (${err.message})`);
  }
}

export function getCachedMessage(instance, msgId) {
  const key = `${instance}:${msgId}`;
  const now = Date.now();

  const hit = memCache.get(key);
  if (hit) {
    if (hit.expiresAt > now) {
      memSet(key, hit); // refrescar posición LRU
      return hit.message;
    }
    memCache.delete(key);
  }

  // Miss en memoria: puede ser un reinicio, o que el LRU lo haya desalojado.
  const row = selectStmt.get(instance, msgId);
  if (!row) return undefined;
  if (row.expires_at <= now) {
    deleteStmt.run(instance, msgId);
    return undefined;
  }

  try {
    const message = JSON.parse(row.message, BufferJSON.reviver);
    memSet(key, { message, expiresAt: row.expires_at });
    return message;
  } catch (err) {
    console.error(`[message-cache] ${instance}: mensaje ${msgId} ilegible en SQLite (${err.message})`);
    deleteStmt.run(instance, msgId);
    return undefined;
  }
}

/** Descarta la caché de una instancia (al eliminarla) */
export function clearMessageCache(instance) {
  const prefix = `${instance}:`;
  for (const key of memCache.keys()) {
    if (key.startsWith(prefix)) memCache.delete(key);
  }
  deleteInstanceStmt.run(instance);
}

/** Elimina las entradas vencidas de SQLite. Devuelve cuántas borró. */
export function purgeExpired() {
  return purgeStmt.run(Date.now()).changes;
}

const purged = purgeExpired();
if (purged > 0) console.log(`[message-cache] ${purged} mensajes vencidos eliminados al arrancar`);

// unref: la limpieza periódica no debe mantener vivo el proceso al apagarse.
setInterval(purgeExpired, PURGE_INTERVAL_MS).unref();
