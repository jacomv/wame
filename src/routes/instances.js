import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { validateInstanceName, normalizeJid, validatePhoneOrJid } from '../utils/jid.js';
import { requireOwnership, sendLimiter } from '../utils/guards.js';
import { connectInstance, getSocket, getInstanceStatus, disconnectInstance, restartInstance } from '../manager.js';
import { sendMessage } from '../sender.js';
import { logMessage } from '../logger.js';
import { dispatch, listWebhooks } from '../webhooks.js';
import { assignInstance, getInstanceOwner, removeInstanceOwner } from '../accounts.js';

const router = Router();

// ── Conectar / reconectar instancia ────────────────────────────
router.post('/:name/connect', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    const result = await connectInstance(req.params.name);

    // Asignar ownership si es una cuenta registrada y la instancia no tiene dueño
    if (req.account && !getInstanceOwner(req.params.name)) {
      assignInstance(req.params.name, req.account.id);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Estado de una instancia (incluye QR si está pendiente) ─────
router.get('/:name/status', requireApiKey, validateInstanceName, requireOwnership, (req, res) => {
  const inst = getInstanceStatus(req.params.name);
  if (!inst) return res.status(404).json({ error: 'Instancia no encontrada' });
  res.json(inst);
});

// ── Enviar mensaje ──────────────────────────────────────────────
router.post('/:name/send', requireApiKey, validateInstanceName, requireOwnership, sendLimiter, async (req, res) => {
  const { name } = req.params;
  const { to, type, ...payload } = req.body;

  if (!to || !type) {
    return res.status(400).json({ error: 'Faltan campos: to, type' });
  }

  // allowNewsletter: publicar en un canal es el mismo sendMessage, solo cambia
  // el JID (…@newsletter). Baileys detecta el servidor y usa la rama de canal.
  if (!validatePhoneOrJid(to, { allowNewsletter: true })) {
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
router.get('/:name/groups', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
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

// ── Participantes de un grupo ───────────────────────────────────
router.get('/:name/groups/:groupId/participants', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  const sock = getSocket(req.params.name);
  if (!sock) return res.status(503).json({ error: 'Instancia no conectada' });
  try {
    const meta = await sock.groupMetadata(req.params.groupId);
    const list = meta.participants.map(p => ({
      id: p.id,
      phone: p.id.replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0],
      admin: p.admin ?? null,
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Verificar si un número está en WhatsApp ─────────────────────
router.post('/:name/check-number', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Campo "number" requerido' });

  if (!validatePhoneOrJid(number)) {
    return res.status(400).json({ error: 'Formato de número inválido' });
  }

  const sock = getSocket(req.params.name);
  if (!sock) return res.status(503).json({ error: 'Instancia no conectada' });

  try {
    const jid = normalizeJid(number);
    const [result] = await sock.onWhatsApp(jid);
    res.json({
      exists: !!result?.exists,
      jid: result?.jid ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Test webhook: dispara payload de prueba y reporta resultado ─
router.post('/:name/webhooks/test', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
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

// ── Reiniciar instancia (sin borrar sesión) ─────────────────────
router.post('/:name/restart', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    const result = await restartInstance(req.params.name);
    if (!result) return res.status(404).json({ error: 'Instancia no encontrada' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Obtener foto de perfil ──────────────────────────────────────
router.get('/:name/profile-picture', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  const { jid } = req.query;
  if (!jid) return res.status(400).json({ error: 'Query param "jid" requerido' });

  if (!validatePhoneOrJid(jid, { allowNewsletter: true })) {
    return res.status(400).json({ error: 'Formato de JID inválido' });
  }

  const sock = getSocket(req.params.name);
  if (!sock) return res.status(503).json({ error: 'Instancia no conectada' });

  try {
    const normalizedJid = normalizeJid(jid);
    const url = await sock.profilePictureUrl(normalizedJid, 'image');
    res.json({ url });
  } catch (err) {
    // WhatsApp devuelve error si no hay foto de perfil
    if (err.message?.includes('not-authorized') || err.message?.includes('item-not-found')) {
      return res.json({ url: null });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Desconectar / eliminar instancia ───────────────────────────
router.delete('/:name', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    const ok = await disconnectInstance(req.params.name);
    if (!ok) return res.status(404).json({ error: 'Instancia no encontrada' });
    removeInstanceOwner(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
