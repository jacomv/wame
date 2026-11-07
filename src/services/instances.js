// Operaciones sobre una instancia, compartidas por la API REST y el servidor MCP.
// Aquí no hay autenticación ni control de propiedad: cada capa los aplica antes
// de llamar (requireOwnership en REST, la autorización OAuth en MCP).
import { getSocket, getInstanceStatus } from '../manager.js';
import { sendMessage } from '../sender.js';
import { logMessage } from '../logger.js';
import { normalizeJid, validatePhoneOrJid } from '../utils/jid.js';

/** Error con el código HTTP que corresponde; MCP lo traduce a un error de herramienta. */
export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireSocket(name, message = 'Instancia no conectada') {
  const sock = getSocket(name);
  if (!sock) throw new ServiceError(503, message);
  return sock;
}

export function instanceStatus(name) {
  const inst = getInstanceStatus(name);
  if (!inst) throw new ServiceError(404, 'Instancia no encontrada');
  return inst;
}

/**
 * Envía un mensaje y lo registra en message_logs.
 * allowNewsletter: publicar en un canal es el mismo sendMessage, solo cambia
 * el JID (…@newsletter). Baileys detecta el servidor y usa la rama de canal.
 */
export async function sendToInstance(name, { to, type, ...payload }, { allowNewsletter = true } = {}) {
  if (!to || !type) throw new ServiceError(400, 'Faltan campos: to, type');
  if (typeof to !== 'string' || !validatePhoneOrJid(to, { allowNewsletter })) {
    throw new ServiceError(400, 'Formato de número/JID inválido');
  }

  const jid = normalizeJid(to);
  const sock = requireSocket(name, `Instancia "${name}" no conectada`);

  try {
    await sendMessage(sock, jid, type, payload);
    await logMessage({ instance: name, to: jid, type, status: 'ok' });
    return { ok: true, to: jid };
  } catch (err) {
    await logMessage({ instance: name, to: jid, type, status: 'error', error: err.message });
    throw new ServiceError(500, err.message);
  }
}

export async function listGroups(name) {
  const sock = requireSocket(name);
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject,
      participants: g.participants?.length ?? 0,
    }));
  } catch (err) {
    throw new ServiceError(500, err.message);
  }
}

export async function listGroupParticipants(name, groupId) {
  const sock = requireSocket(name);
  try {
    const meta = await sock.groupMetadata(groupId);
    return meta.participants.map(p => ({
      id: p.id,
      phone: p.id.replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0],
      admin: p.admin ?? null,
    }));
  } catch (err) {
    throw new ServiceError(500, err.message);
  }
}

export async function checkNumber(name, number) {
  if (!number) throw new ServiceError(400, 'Campo "number" requerido');
  if (typeof number !== 'string' || !validatePhoneOrJid(number)) {
    throw new ServiceError(400, 'Formato de número inválido');
  }

  const sock = requireSocket(name);
  try {
    const jid = normalizeJid(number);
    const [result] = await sock.onWhatsApp(jid);
    return {
      exists: !!result?.exists,
      jid: result?.jid ?? null,
      // Identidad LID del contacto, o null si no tiene o no se conoce todavía.
      // Se lee de dos sitios porque cambió de lugar: 6.7.x la incluía en la
      // respuesta de onWhatsApp(), y 7.x ya no —ahora vive en el
      // LIDMappingStore del signalRepository, que es quien traduce LID↔PN al
      // cifrar. Probar ambos deja la ruta funcionando en las dos versiones.
      lid: result?.lid ?? (await lookupLid(sock, jid)),
    };
  } catch (err) {
    throw new ServiceError(500, err.message);
  }
}

/**
 * Consulta el LID de un número en el LIDMappingStore (Baileys 7.x).
 * Devuelve null en 6.7.x, donde el store no existe, y ante cualquier fallo:
 * es un dato de diagnóstico, no vale hacer caer la petición por él.
 */
async function lookupLid(sock, jid) {
  try {
    return (await sock.signalRepository?.lidMapping?.getLIDForPN?.(jid)) ?? null;
  } catch {
    return null;
  }
}
