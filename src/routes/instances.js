import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { validateInstanceName, normalizeJid, validatePhoneOrJid } from '../utils/jid.js';
import { requireOwnership, requireOwnershipOrClaim, sendLimiter } from '../utils/guards.js';
import { connectInstance, getSocket, disconnectInstance, restartInstance } from '../manager.js';
import { ServiceError, instanceStatus, sendToInstance, listGroups, listGroupParticipants, checkNumber } from '../services/instances.js';
import { dispatch, listWebhooks } from '../webhooks.js';
import { removeInstanceOwner } from '../accounts.js';

const router = Router();

/** Responde un error de la capa de servicios con su código HTTP. */
function sendServiceError(res, err) {
  res.status(err instanceof ServiceError ? err.status : 500).json({ error: err.message });
}

// ── Conectar / reconectar instancia ────────────────────────────
// Una cuenta reclama el nombre si está libre (ver requireOwnershipOrClaim)
router.post('/:name/connect', requireApiKey, validateInstanceName, requireOwnershipOrClaim, async (req, res) => {
  try {
    const result = await connectInstance(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Estado de una instancia (incluye QR si está pendiente) ─────
router.get('/:name/status', requireApiKey, validateInstanceName, requireOwnership, (req, res) => {
  try {
    res.json(instanceStatus(req.params.name));
  } catch (err) {
    sendServiceError(res, err);
  }
});

// ── Enviar mensaje ──────────────────────────────────────────────
router.post('/:name/send', requireApiKey, validateInstanceName, requireOwnership, sendLimiter, async (req, res) => {
  try {
    await sendToInstance(req.params.name, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    sendServiceError(res, err);
  }
});

// ── Listar grupos de una instancia ─────────────────────────────
router.get('/:name/groups', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    res.json(await listGroups(req.params.name));
  } catch (err) {
    sendServiceError(res, err);
  }
});

// ── Participantes de un grupo ───────────────────────────────────
router.get('/:name/groups/:groupId/participants', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    res.json(await listGroupParticipants(req.params.name, req.params.groupId));
  } catch (err) {
    sendServiceError(res, err);
  }
});

// ── Verificar si un número está en WhatsApp ─────────────────────
router.post('/:name/check-number', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    res.json(await checkNumber(req.params.name, req.body?.number));
  } catch (err) {
    sendServiceError(res, err);
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
