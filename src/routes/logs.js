import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { getLogs } from '../logger.js';

const router = Router();

router.get('/', requireApiKey, async (req, res) => {
  try {
    const { instance, limit } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 20, 100);
    const data = await getLogs({ instance, limit: parsedLimit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
