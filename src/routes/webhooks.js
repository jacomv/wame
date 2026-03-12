import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { validateInstanceName } from '../utils/jid.js';
import { addWebhook, listWebhooks, removeWebhook, VALID_EVENTS } from '../webhooks.js';

const router = Router();

// ── Registrar webhook ───────────────────────────────────────────
router.post('/:name/webhooks', requireApiKey, validateInstanceName, async (req, res) => {
  try {
    const hook = await addWebhook(req.params.name, req.body);
    res.status(201).json(hook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Listar webhooks ─────────────────────────────────────────────
router.get('/:name/webhooks', requireApiKey, validateInstanceName, async (req, res) => {
  try {
    const hooks = await listWebhooks(req.params.name);
    res.json({ webhooks: hooks, availableEvents: [...VALID_EVENTS] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Eliminar webhook ────────────────────────────────────────────
router.delete('/:name/webhooks/:id', requireApiKey, validateInstanceName, async (req, res) => {
  try {
    const ok = await removeWebhook(req.params.name, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Webhook no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
