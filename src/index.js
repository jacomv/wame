import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { requireApiKey } from './auth.js';
import { getAllStatus, restoreExistingSessions, shutdown } from './manager.js';
import { getOwnedInstances } from './accounts.js';
import { checkUpdates } from './updater.js';
import authRoutes from './routes/auth.js';
import instanceRoutes from './routes/instances.js';
import webhookRoutes from './routes/webhooks.js';
import logRoutes from './routes/logs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);

// ── Seguridad ───────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
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

// Servir UI estática (sin auth)
app.use(express.static(join(__dirname, 'public')));

// ── Health check (sin auth, para load balancers / Docker) ───────
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ── Auth routes (públicas) ──────────────────────────────────────
app.use('/auth', authRoutes);

// ── Rutas ───────────────────────────────────────────────────────
app.get('/instances', requireApiKey, (req, res) => {
  const all = getAllStatus();
  if (req.isAdmin) return res.json({ instances: all });

  // Filtrar por instancias propias
  const owned = new Set(getOwnedInstances(req.account.id));
  res.json({ instances: all.filter(i => owned.has(i.name)) });
});

// Alias legacy
app.get('/status', requireApiKey, (req, res) => {
  const all = getAllStatus();
  if (req.isAdmin) return res.json({ instances: all });

  const owned = new Set(getOwnedInstances(req.account.id));
  res.json({ instances: all.filter(i => owned.has(i.name)) });
});
app.use('/instances', instanceRoutes);
app.use('/instances', webhookRoutes);
app.use('/logs', logRoutes);

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
