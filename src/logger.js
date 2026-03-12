import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || './data';
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(`${DATA_DIR}/wame.db`);

db.exec(`
  CREATE TABLE IF NOT EXISTS message_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance TEXT NOT NULL,
    "to" TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_message_logs_instance ON message_logs(instance);
  CREATE INDEX IF NOT EXISTS idx_message_logs_created_at ON message_logs(created_at);
`);

const stmtInsert = db.prepare(
  `INSERT INTO message_logs (instance, "to", type, status, error) VALUES (?, ?, ?, ?, ?)`
);

const stmtSelectAll = db.prepare(
  `SELECT * FROM message_logs ORDER BY created_at DESC LIMIT ?`
);

const stmtSelectByInstance = db.prepare(
  `SELECT * FROM message_logs WHERE instance = ? ORDER BY created_at DESC LIMIT ?`
);

export function logMessage({ instance, to, type, status, error = null }) {
  try {
    stmtInsert.run(instance, to, type, status, error);
  } catch (err) {
    console.error('[logger] Error guardando log:', err.message);
  }
}

export function getLogs({ instance, limit = 20 }) {
  if (instance) {
    return stmtSelectByInstance.all(instance, limit);
  }
  return stmtSelectAll.all(limit);
}
