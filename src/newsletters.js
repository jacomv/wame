import db from './db.js';
import { isNewsletterJid } from './utils/jid.js';

// Canales (newsletters) seguidos por cada instancia.
//
// Baileys no expone ninguna forma de listar los canales de una cuenta: tiene
// groupFetchAllParticipating() para grupos y communityFetchAllParticipating()
// para comunidades, pero no existe el equivalente para canales — ni en 6.7.x
// ni en la rama 7.0.0-rc. WhatsApp tampoco los manda en el history sync que
// pedimos (syncFullHistory: false), así que no hay nada de dónde derivarlos.
//
// Por eso el registro es propio: se da de alta un canal por su JID o por su
// código de invitación, se guarda aquí, y a partir de ahí GET /newsletters
// puede listarlo y refrescar sus metadatos contra WhatsApp.
db.exec(`
  CREATE TABLE IF NOT EXISTS newsletters (
    instance TEXT NOT NULL,
    jid TEXT NOT NULL,
    name TEXT,
    invite TEXT,
    role TEXT,
    subscribers INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (instance, jid)
  ) WITHOUT ROWID;
`);

const stmtUpsert = db.prepare(
  `INSERT INTO newsletters (instance, jid, name, invite, role, subscribers)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(instance, jid) DO UPDATE SET
     name = excluded.name,
     invite = excluded.invite,
     role = excluded.role,
     subscribers = excluded.subscribers`
);
const stmtList = db.prepare(
  `SELECT jid, name, invite, role, subscribers, created_at FROM newsletters
   WHERE instance = ? ORDER BY created_at ASC`
);
const stmtGet = db.prepare(`SELECT jid FROM newsletters WHERE instance = ? AND jid = ?`);
const stmtDelete = db.prepare(`DELETE FROM newsletters WHERE instance = ? AND jid = ?`);
const stmtDeleteAll = db.prepare(`DELETE FROM newsletters WHERE instance = ?`);

// Solo un administrador o el dueño pueden publicar. Un SUBSCRIBER que intente
// enviar recibe un error del servidor de WhatsApp bastante opaco, así que
// conviene cortarlo antes con un mensaje que se entienda.
const PUBLISH_ROLES = new Set(['ADMIN', 'OWNER']);

/** true si el rol del canal permite publicar en él */
export function canPublish(role) {
  return PUBLISH_ROLES.has(String(role ?? '').toUpperCase());
}

/**
 * Normaliza la respuesta de sock.newsletterMetadata().
 * La forma cruda que devuelve WhatsApp no siempre coincide con el tipo
 * NewsletterMetadata de Baileys (viewer_metadata, por ejemplo, viene en la
 * respuesta pero no está declarado), así que se leen ambas variantes.
 */
export function normalizeMetadata(meta) {
  if (!meta?.id) return null;
  const thread = meta.thread_metadata ?? {};
  const text = (v) => (typeof v === 'object' && v !== null ? (v.text ?? null) : (v ?? null));
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    jid: meta.id,
    name: text(meta.name) ?? text(thread.name),
    description: text(meta.description) ?? text(thread.description),
    invite: meta.invite ?? thread.invite ?? null,
    subscribers: num(meta.subscribers ?? thread.subscribers_count),
    verification: meta.verification ?? thread.verification ?? null,
    role: meta.viewer_metadata?.role ?? null,
    muted: (meta.mute_state ?? meta.viewer_metadata?.mute ?? null) === 'ON',
    createdAt: num(meta.creation_time ?? thread.creation_time),
  };
}

/**
 * Consulta los metadatos de un canal en WhatsApp, por JID o por código de
 * invitación. Devuelve null si el canal no existe o no es visible.
 */
export async function fetchNewsletter(sock, { jid, invite }) {
  const [type, key] = jid ? ['jid', jid] : ['invite', invite];
  const meta = await sock.newsletterMetadata(type, key);
  return normalizeMetadata(meta);
}

/** Da de alta (o refresca) un canal en el registro de la instancia */
export function trackNewsletter(instance, meta) {
  stmtUpsert.run(instance, meta.jid, meta.name, meta.invite, meta.role, meta.subscribers);
}

/** Canales registrados de una instancia, tal como están en el registro */
export function listTrackedNewsletters(instance) {
  return stmtList.all(instance).map((row) => ({
    jid: row.jid,
    name: row.name,
    invite: row.invite,
    role: row.role,
    subscribers: row.subscribers,
    canPublish: canPublish(row.role),
    trackedAt: row.created_at,
  }));
}

/** true si el canal está registrado para esa instancia */
export function isTracked(instance, jid) {
  return !!stmtGet.get(instance, jid);
}

/** Quita un canal del registro. No afecta a WhatsApp: no deja de seguirlo. */
export function untrackNewsletter(instance, jid) {
  return stmtDelete.run(instance, jid).changes > 0;
}

/** Borra el registro completo de una instancia (al eliminarla) */
export function clearNewsletters(instance) {
  stmtDeleteAll.run(instance);
}

/**
 * Refresca contra WhatsApp los canales registrados y devuelve la lista.
 * Un canal que ya no se puede consultar (borrado, o la cuenta dejó de tener
 * acceso) se devuelve con los datos guardados y `stale: true` en vez de
 * hacer fallar la petición entera.
 */
export async function listNewslettersWithMetadata(sock, instance) {
  const tracked = listTrackedNewsletters(instance);

  return Promise.all(
    tracked.map(async (row) => {
      if (!isNewsletterJid(row.jid)) return { ...row, stale: true };
      try {
        const meta = await fetchNewsletter(sock, { jid: row.jid });
        if (!meta) return { ...row, stale: true };
        trackNewsletter(instance, meta);
        return { ...meta, canPublish: canPublish(meta.role), trackedAt: row.trackedAt, stale: false };
      } catch (err) {
        return { ...row, stale: true, error: err.message };
      }
    })
  );
}
