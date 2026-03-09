import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { requireApiKey } from './auth.js';
import { connectInstance, getSocket, getAllStatus, getInstanceStatus, disconnectInstance, restoreExistingSessions } from './manager.js';
import { sendMessage } from './sender.js';
import { logMessage, getLogs } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Servir UI estática (sin auth)
app.use(express.static(join(__dirname, 'public')));

// ── Estado general ──────────────────────────────────────────────
app.get('/status', requireApiKey, (_req, res) => {
  res.json({ instances: getAllStatus() });
});

// ── Conectar / reconectar instancia ────────────────────────────
app.post('/instances/:name/connect', requireApiKey, async (req, res) => {
  const { name } = req.params;
  try {
    const result = await connectInstance(name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Estado de una instancia (incluye QR si está pendiente) ─────
app.get('/instances/:name/status', requireApiKey, (req, res) => {
  const inst = getInstanceStatus(req.params.name);
  if (!inst) return res.status(404).json({ error: 'Instancia no encontrada' });
  res.json(inst);
});

// ── Enviar mensaje ──────────────────────────────────────────────
app.post('/instances/:name/send', requireApiKey, async (req, res) => {
  const { name } = req.params;
  const { to, type, ...payload } = req.body;

  if (!to || !type) {
    return res.status(400).json({ error: 'Faltan campos: to, type' });
  }

  const sock = getSocket(name);
  if (!sock) {
    return res.status(503).json({ error: `Instancia "${name}" no conectada` });
  }

  try {
    await sendMessage(sock, to, type, payload);
    await logMessage({ instance: name, to, type, status: 'ok' });
    res.json({ ok: true });
  } catch (err) {
    await logMessage({ instance: name, to, type, status: 'error', error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Listar grupos de una instancia ─────────────────────────────
app.get('/instances/:name/groups', requireApiKey, async (req, res) => {
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
app.delete('/instances/:name', requireApiKey, async (req, res) => {
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
    const data = await getLogs({ instance, limit: limit ? parseInt(limit) : 20 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Arranque ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`WhatsApp Sender corriendo en puerto ${PORT}`);
  await restoreExistingSessions();
});
