import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { validateInstanceName } from '../utils/jid.js';
import { addWebhook, listWebhooks, removeWebhook, updateWebhook, VALID_EVENTS } from '../webhooks.js';
import { getInstanceOwner } from '../accounts.js';

const router = Router();

/** Middleware: verifica ownership de la instancia */
function requireOwnership(req, res, next) {
  if (req.isAdmin) return next();
  const owner = getInstanceOwner(req.params.name);
  if (owner !== null && owner !== req.account?.id) {
    return res.status(403).json({ error: 'No tienes acceso a esta instancia' });
  }
  next();
}

// ── Registrar webhook ───────────────────────────────────────────
router.post('/:name/webhooks', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    const hook = await addWebhook(req.params.name, req.body);
    res.status(201).json(hook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Listar webhooks ─────────────────────────────────────────────
router.get('/:name/webhooks', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    const hooks = await listWebhooks(req.params.name);
    res.json({ webhooks: hooks, availableEvents: [...VALID_EVENTS] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Actualizar webhook ──────────────────────────────────────────
router.put('/:name/webhooks/:id', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    const hook = await updateWebhook(req.params.name, req.params.id, req.body);
    if (!hook) return res.status(404).json({ error: 'Webhook no encontrado' });
    res.json(hook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Eliminar webhook ────────────────────────────────────────────
router.delete('/:name/webhooks/:id', requireApiKey, validateInstanceName, requireOwnership, async (req, res) => {
  try {
    const ok = await removeWebhook(req.params.name, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Webhook no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
