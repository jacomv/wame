import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { mkdirSync } from 'fs';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';

const SESSION_DIR = process.env.SESSION_DIR || './data/sessions';
const logger = pino({ level: 'silent' }); // silencia logs internos de Baileys

// Map de instancias activas: name → { sock, status, qr, phone, connectedAt }
const instances = new Map();
// Set para evitar reconexiones simultáneas
const reconnecting = new Set();

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
  // Garantizar que el directorio existe antes de que Baileys escriba en él
  mkdirSync(sessionPath, { recursive: true });
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
        setTimeout(() => connectInstance(name), 5000);
      } else {
        instances.set(name, { sock: null, status: 'logged_out', qr: null, phone: null, connectedAt: null });
      }
    }
  });

  return new Promise((resolve) => {
    const check = setInterval(() => {
      const inst = instances.get(name);
      if (inst?.status === 'connected') {
        clearInterval(check);
        resolve({ status: 'connected' });
      } else if (inst?.status === 'qr') {
        clearInterval(check);
        resolve({ status: 'qr', qr: inst.qr });
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
  const { readdirSync, existsSync } = await import('fs');
  if (!existsSync(SESSION_DIR)) return;
  const dirs = readdirSync(SESSION_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of dirs) {
    console.log(`[manager] Restaurando sesión: ${name}`);
    connectInstance(name).catch((e) => console.error(`[manager] Error restaurando ${name}:`, e));
  }
}
