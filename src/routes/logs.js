import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { getLogs } from '../logger.js';
import { getOwnedInstances } from '../accounts.js';

const router = Router();

router.get('/', requireApiKey, (req, res) => {
  try {
    const { instance, limit } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 20, 100);

    // Admin ve todo; cuentas registradas solo ven sus instancias
    if (req.isAdmin) {
      const data = getLogs({ instance, limit: parsedLimit });
      return res.json(data);
    }

    const ownedNames = getOwnedInstances(req.account.id);
    // Si se pide una instancia específica, verificar que sea propia
    if (instance) {
      if (!ownedNames.includes(instance)) {
        return res.json([]);
      }
      return res.json(getLogs({ instance, limit: parsedLimit }));
    }

    const data = getLogs({ limit: parsedLimit, instanceNames: ownedNames });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
