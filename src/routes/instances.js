import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireApiKey } from '../auth.js';
import { validateInstanceName, normalizeJid, validatePhoneOrJid } from '../utils/jid.js';
import { connectInstance, getSocket, getInstanceStatus, disconnectInstance } from '../manager.js';
import { sendMessage } from '../sender.js';
import { logMessage } from '../logger.js';
import { dispatch, listWebhooks } from '../webhooks.js';

const router = Router();

// Rate limiting estricto para envío de mensajes: 30 req/min por IP
const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.SEND_RATE_LIMIT || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de envío alcanzado. Intenta más tarde.' },
});

// ── Conectar / reconectar instancia ────────────────────────────
router.post('/:name/connect', requireApiKey, validateInstanceName, async (req, res) => {
  try {
    const result = await connectInstance(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Estado de una instancia (incluye QR si está pendiente) ─────
router.get('/:name/status', requireApiKey, validateInstanceName, (req, res) => {
  const inst = getInstanceStatus(req.params.name);
  if (!inst) return res.status(404).json({ error: 'Instancia no encontrada' });
  res.json(inst);
});

// ── Enviar mensaje ──────────────────────────────────────────────
router.post('/:name/send', requireApiKey, validateInstanceName, sendLimiter, async (req, res) => {
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
router.get('/:name/groups', requireApiKey, validateInstanceName, async (req, res) => {
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

// ── Test webhook: dispara payload de prueba y reporta resultado ─
router.post('/:name/webhooks/test', requireApiKey, validateInstanceName, async (req, res) => {
  const { name } = req.params;
  const hooks = await listWebhooks(name);
  if (!hooks.length) return res.status(404).json({ error: 'No hay webhooks registrados para esta instancia' });

  const results = await Promise.all(
    hooks.map(async (hook) => {
      const payload = JSON.stringify({
        event: 'messages',
        instance: name,
        timestamp: new Date().toISOString(),
        data: { from: 'test@s.whatsapp.net', pushName: 'Test', type: 'text', text: 'Mensaje de prueba', messageId: 'test-001', isGroup: false },
      });
      try {
        const r = await fetch(hook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(7000),
        });
        const body = await r.text();
        return { url: hook.url, events: hook.events, httpStatus: r.status, ok: r.ok, response: body.slice(0, 200) };
      } catch (err) {
        return { url: hook.url, events: hook.events, error: err.message };
      }
    })
  );
  res.json({ results });
});

// ── Desconectar / eliminar instancia ───────────────────────────
router.delete('/:name', requireApiKey, validateInstanceName, async (req, res) => {
  try {
    const ok = await disconnectInstance(req.params.name);
    if (!ok) return res.status(404).json({ error: 'Instancia no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
