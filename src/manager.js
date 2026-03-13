import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { mkdir } from 'fs/promises';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';
import { dispatch } from './webhooks.js';

const SESSION_DIR = process.env.SESSION_DIR || './data/sessions';
const QR_TIMEOUT_MS = 60_000; // Timeout para esperar QR/conexión
const logger = pino({ level: 'silent' });

// Map de instancias activas: name → { sock, status, qr, phone, connectedAt }
const instances = new Map();
// Set para evitar reconexiones simultáneas
const reconnecting = new Set();
// Map de timers de reconexión pendientes para poder cancelarlos
const reconnectTimers = new Map();

// Resuelve un JID a número de teléfono.
// @s.whatsapp.net → extrae el número directamente.
// @lid → busca en el caché de contactos de Baileys el JID de teléfono asociado.
// Retorna null si no se puede resolver (contacto no sincronizado aún).
function resolvePhone(sock, jid) {
  if (jid.endsWith('@s.whatsapp.net')) {
    return jid.split('@')[0].split(':')[0];
  }
  if (jid.endsWith('@lid')) {
    const contacts = sock.contacts || {};
    for (const contact of Object.values(contacts)) {
      if (contact.lid === jid) {
        return contact.id?.split('@')[0]?.split(':')[0] ?? null;
      }
    }
  }
  return null;
}

export async function connectInstance(name) {
  // Si ya está conectada, no hacer nada
  if (instances.has(name)) {
    const inst = instances.get(name);
    if (inst.status === 'connected') return { status: 'connected' };
  }

  // Evitar reconexiones simultáneas
  if (reconnecting.has(name)) return { status: 'connecting' };
  reconnecting.add(name);

  const sessionPath = path.join(SESSION_DIR, name);
  await mkdir(sessionPath, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: ['WhatsApp Sender', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: true,
  });

  // Entrada inicial en el mapa
  instances.set(name, { sock, status: 'connecting', qr: null, phone: null, connectedAt: null });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const inst = instances.get(name);
    if (!inst) return; // Instancia fue eliminada mientras procesaba

    if (qr) {
      const qrImage = await QRCode.toDataURL(qr);
      instances.set(name, { ...inst, status: 'qr', qr: qrImage });
      reconnecting.delete(name);
      console.log(`[${name}] QR generado, esperando escaneo...`);
    }

    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] ?? null;
      instances.set(name, { ...inst, status: 'connected', qr: null, phone, connectedAt: new Date().toISOString() });
      reconnecting.delete(name);
      console.log(`[${name}] Conectado como ${phone}`);
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`[${name}] Desconectado. Razón: ${reason}. Reconectar: ${shouldReconnect}`);
      reconnecting.delete(name);

      if (shouldReconnect) {
        instances.delete(name);
        // Guardar referencia al timer para poder cancelarlo
        const timer = setTimeout(() => {
          reconnectTimers.delete(name);
          connectInstance(name);
        }, 5000);
        reconnectTimers.set(name, timer);
      } else {
        instances.set(name, { sock: null, status: 'logged_out', qr: null, phone: null, connectedAt: null });
      }
    }
  });

  // ── Webhook: mensajes entrantes ──────────────────────────────
  sock.ev.on('messages.upsert', ({ messages, type: upsertType }) => {
    if (upsertType !== 'notify') return; // Solo mensajes nuevos, no historial
    for (const msg of messages) {
      if (msg.key.fromMe) continue; // Ignorar mensajes propios
      const from = msg.key.remoteJid;
      const pushName = msg.pushName || null;
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || null;
      const msgType = text ? 'text'
        : msg.message?.imageMessage ? 'image'
        : msg.message?.audioMessage ? 'audio'
        : msg.message?.documentMessage ? 'document'
        : msg.message?.videoMessage ? 'video'
        : null;

      if (!msgType) continue; // Ignorar reacciones, stickers, polls, etc.

      dispatch(name, 'messages', {
        from,
        pushName,
        type: msgType,
        text,
        messageId: msg.key.id,
        isGroup: from?.endsWith('@g.us') || false,
      });
    }
  });

  // ── Webhook: cambios de participantes en grupos ────────────
  sock.ev.on('group-participants.update', ({ id, participants, action }) => {
    const resolved = participants.map(jid => ({
      jid,
      phone: resolvePhone(sock, jid),
    }));
    if (action === 'add') {
      dispatch(name, 'group.join', { groupId: id, participants: resolved });
    } else if (action === 'remove') {
      dispatch(name, 'group.leave', { groupId: id, participants: resolved });
    }
  });

  return new Promise((resolve) => {
    let elapsed = 0;
    const check = setInterval(() => {
      elapsed += 300;
      const inst = instances.get(name);

      if (inst?.status === 'connected') {
        clearInterval(check);
        resolve({ status: 'connected' });
      } else if (inst?.status === 'qr') {
        clearInterval(check);
        resolve({ status: 'qr', qr: inst.qr });
      } else if (elapsed >= QR_TIMEOUT_MS) {
        clearInterval(check);
        reconnecting.delete(name);
        resolve({ status: 'timeout', error: 'Tiempo de espera agotado para QR/conexión' });
      }
    }, 300);
  });
}

export function getSocket(name) {
  return instances.get(name)?.sock ?? null;
}

export function getAllStatus() {
  return Array.from(instances.entries()).map(([name, inst]) => ({
    name,
    status: inst.status,
    phone: inst.phone,
    connectedAt: inst.connectedAt,
  }));
}

export function getInstanceStatus(name) {
  const inst = instances.get(name);
  if (!inst) return null;
  return {
    name,
    status: inst.status,
    qr: inst.qr,
    phone: inst.phone,
    connectedAt: inst.connectedAt,
  };
}

export async function disconnectInstance(name) {
  const inst = instances.get(name);
  if (!inst) return false;

  // Cancelar reconexión pendiente si existe
  const timer = reconnectTimers.get(name);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(name);
  }

  reconnecting.add(name); // bloquear reconexión automática durante el proceso
  try {
    if (inst.sock) await inst.sock.logout();
  } catch (_) {
    try { inst.sock?.end(); } catch (_) {}
  }

  instances.delete(name);
  reconnecting.delete(name);

  // Borrar archivos de sesión
  const { rm } = await import('fs/promises');
  const sessionPath = path.join(SESSION_DIR, name);
  await rm(sessionPath, { recursive: true, force: true });

  return true;
}

// Al arrancar, reconectar instancias que tengan sesión guardada
export async function restoreExistingSessions() {
  const { readdir } = await import('fs/promises');
  try {
    const entries = await readdir(SESSION_DIR, { withFileTypes: true });
    const dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);

    for (const name of dirs) {
      console.log(`[manager] Restaurando sesión: ${name}`);
      connectInstance(name).catch((e) => console.error(`[manager] Error restaurando ${name}:`, e));
    }
  } catch (err) {
    if (err.code === 'ENOENT') return; // Directorio no existe, nada que restaurar
    throw err;
  }
}

/** Apagado limpio: desconectar todos los sockets */
export async function shutdown() {
  // Cancelar todos los timers de reconexión
  for (const [name, timer] of reconnectTimers) {
    clearTimeout(timer);
    reconnectTimers.delete(name);
    console.log(`[manager] Reconexión de ${name} cancelada`);
  }

  for (const [name, inst] of instances) {
    try {
      if (inst.sock) {
        inst.sock.end();
        console.log(`[manager] ${name} desconectado`);
      }
    } catch (_) {}
  }
  instances.clear();
  reconnecting.clear();
}
