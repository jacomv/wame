import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

const DATA_DIR = process.env.DATA_DIR || './data';
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(`${DATA_DIR}/wame.db`);
db.pragma('journal_mode = WAL');

// ── Accounts ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_api_key ON accounts(api_key);
  CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
`);

// ── Instance ownership ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS instance_owners (
    instance_name TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (instance_name),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
`);

// ── Message logs (migrated from logger.js) ──────────────────────
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

export default db;
