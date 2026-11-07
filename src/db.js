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

// ── Revocable panel sessions (token hashes only) ──────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS panel_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_panel_sessions_expiry ON panel_sessions(expires_at);
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

// ── OAuth 2.1 para clientes MCP ─────────────────────────────────
// Secretos, códigos y tokens se guardan solo como SHA-256. Un grant es la
// autorización de una cuenta a un cliente: sus permisos e instancias se leen en
// cada petición, así que revocar o reducir un grant tiene efecto inmediato.
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret_hash TEXT,
    client_secret_expires_at INTEGER,
    metadata TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS oauth_pending_authorizations (
    id_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    state TEXT,
    scopes TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mcp_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    scopes TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mcp_grants_account ON mcp_grants(account_id);

  CREATE TABLE IF NOT EXISTS mcp_grant_instances (
    grant_id INTEGER NOT NULL,
    instance_name TEXT NOT NULL,
    PRIMARY KEY (grant_id, instance_name)
  );

  CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code_hash TEXT PRIMARY KEY,
    grant_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_access_tokens (
    token_hash TEXT PRIMARY KEY,
    grant_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_access_tokens_grant ON oauth_access_tokens(grant_id);

  CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    grant_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    rotated_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_refresh_tokens_grant ON oauth_refresh_tokens(grant_id);

  CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    event TEXT NOT NULL,
    account_id INTEGER,
    grant_id INTEGER,
    client_id TEXT,
    instance TEXT,
    tool TEXT,
    outcome TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mcp_audit_grant ON mcp_audit_log(grant_id, created_at);
`);

export default db;
