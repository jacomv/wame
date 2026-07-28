import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { getUpdateStatus } from '../updater.js';

const router = Router();

// Autenticado a propósito: /health es público y anunciar ahí la versión le
// dice a cualquiera qué vulnerabilidades conocidas probar.
router.get('/', requireApiKey, async (_req, res) => {
  try {
    res.json(await getUpdateStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
