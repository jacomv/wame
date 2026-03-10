import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { requireApiKey } from './auth.js';
import { connectInstance, getSocket, getAllStatus, getInstanceStatus, disconnectInstance, restoreExistingSessions, shutdown } from './manager.js';
import { sendMessage } from './sender.js';
import { logMessage, getLogs } from './logger.js';
import { checkUpdates } from './updater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);

// ── Seguridad ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// Rate limiting global: 100 req/min por IP
app.use(rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta más tarde.' },
}));

// Rate limiting estricto para envío de mensajes: 30 req/min por IP
const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.SEND_RATE_LIMIT || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de envío alcanzado. Intenta más tarde.' },
});

// Servir UI estática (sin auth)
app.use(express.static(join(__dirname, 'public')));

// ── Health check (sin auth, para load balancers / Docker) ───────
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ── Estado general ──────────────────────────────────────────────
app.get('/status', requireApiKey, (_req, res) => {
  res.json({ instances: getAllStatus() });
});

// ── Validar nombre de instancia (prevenir path traversal) ───────
function validateInstanceName(req, res, next) {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    return res.status(400).json({ error: 'Nombre de instancia inválido. Solo letras, números, _ y - (máx 64 caracteres)' });
  }
  next();
}

// ── Conectar / reconectar instancia ────────────────────────────
app.post('/instances/:name/connect', requireApiKey, validateInstanceName, async (req, res) => {
  const { name } = req.params;
  try {
    const result = await connectInstance(name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Estado de una instancia (incluye QR si está pendiente) ─────
app.get('/instances/:name/status', requireApiKey, validateInstanceName, (req, res) => {
  const inst = getInstanceStatus(req.params.name);
  if (!inst) return res.status(404).json({ error: 'Instancia no encontrada' });
  res.json(inst);
});

// ── Normalizar JID ──────────────────────────────────────────────
function normalizeJid(to) {
  // Limpiar caracteres comunes que el usuario podría incluir
  const cleaned = to.replace(/[\s+()-]/g, '');
  if (cleaned.includes('@')) return cleaned;
  return `${cleaned}@s.whatsapp.net`;
}

// ── Validar número de teléfono ──────────────────────────────────
function validatePhoneOrJid(to) {
  const cleaned = to.replace(/[\s+()-]/g, '');
  // Si tiene @, es un JID completo — aceptar formato grupo o individual
  if (cleaned.includes('@')) {
    return /^[\w.-]+@(s\.whatsapp\.net|g\.us)$/.test(cleaned);
  }
  // Solo número: entre 7 y 15 dígitos (estándar E.164 sin +)
  return /^\d{7,15}$/.test(cleaned);
}

// ── Enviar mensaje ──────────────────────────────────────────────
app.post('/instances/:name/send', requireApiKey, validateInstanceName, sendLimiter, async (req, res) => {
  const { name } = req.params;
  const { to, type, ...payload } = req.body;

  if (!to || !type) {
    return res.status(400).json({ error: 'Faltan campos: to, type' });
  }

  if (!validatePhoneOrJid(to)) {
    return res.status(400).json({ error: 'Formato de número/JID inválido' });
  }

  const jid = normalizeJid(to);
  const sock = getSocket(name);
  if (!sock) {
    return res.status(503).json({ error: `Instancia "${name}" no conectada` });
  }

  try {
    await sendMessage(sock, jid, type, payload);
    await logMessage({ instance: name, to: jid, type, status: 'ok' });
    res.json({ ok: true });
  } catch (err) {
    await logMessage({ instance: name, to: jid, type, status: 'error', error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Listar grupos de una instancia ─────────────────────────────
app.get('/instances/:name/groups', requireApiKey, validateInstanceName, async (req, res) => {
  const sock = getSocket(req.params.name);
  if (!sock) return res.status(503).json({ error: 'Instancia no conectada' });
  try {
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map(g => ({
      id: g.id,
      name: g.subject,
      participants: g.participants?.length ?? 0,
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Desconectar / eliminar instancia ───────────────────────────
app.delete('/instances/:name', requireApiKey, validateInstanceName, async (req, res) => {
  const { name } = req.params;
  try {
    const ok = await disconnectInstance(name);
    if (!ok) return res.status(404).json({ error: 'Instancia no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logs ────────────────────────────────────────────────────────
app.get('/logs', requireApiKey, async (req, res) => {
  try {
    const { instance, limit } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 20, 100); // Máximo 100 logs
    const data = await getLogs({ instance, limit: parsedLimit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Arranque ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, async () => {
  console.log(`WhatsApp Sender corriendo en puerto ${PORT}`);
  await restoreExistingSessions();
  await checkUpdates();
});

// ── Apagado limpio ──────────────────────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`\n[server] ${signal} recibido. Cerrando conexiones...`);
  await shutdown();
  server.close(() => {
    console.log('[server] Servidor cerrado limpiamente.');
    process.exit(0);
  });
  // Forzar cierre si tarda más de 10s
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
