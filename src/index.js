import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from './db.js';
import { requireApiKey } from './auth.js';
import { getAllStatus, restoreExistingSessions, shutdown } from './manager.js';
import { getOwnedInstances } from './accounts.js';
import { checkUpdates } from './updater.js';
import authRoutes from './routes/auth.js';
import instanceRoutes from './routes/instances.js';
import webhookRoutes from './routes/webhooks.js';
import logRoutes from './routes/logs.js';
import versionRoutes from './routes/version.js';

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
app.use('/version', versionRoutes);

// ── Arranque ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, async () => {
  console.log(`WhatsApp Sender corriendo en puerto ${PORT}`);
  await restoreExistingSessions();
  await checkUpdates();
});

// ── Apagado limpio ──────────────────────────────────────────────
// El plazo debe quedar por debajo del SIGKILL de Docker (10s por defecto):
// si nos matan a mitad del cierre, el checkpoint de SQLite queda a medias.
const SHUTDOWN_TIMEOUT_MS = 5_000;
let shuttingDown = false;

function closeDatabase() {
  try {
    db.close(); // hace checkpoint del WAL y libera el archivo
  } catch (err) {
    console.error('[server] Error cerrando la base de datos:', err.message);
  }
}

async function gracefulShutdown(signal) {
  if (shuttingDown) return; // SIGTERM seguido de SIGINT no debe cerrar dos veces
  shuttingDown = true;

  console.log(`\n[server] ${signal} recibido. Cerrando conexiones...`);

  // Forzar cierre si algo se cuelga, pero cerrando la BD primero.
  const force = setTimeout(() => {
    console.error('[server] Cierre forzado por timeout.');
    closeDatabase();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await shutdown();
  } catch (err) {
    console.error('[server] Error cerrando instancias:', err.message);
  }

  server.close(() => {
    clearTimeout(force);
    closeDatabase();
    console.log('[server] Servidor cerrado limpiamente.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
