import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import db from './db.js';

const stmtInsert = db.prepare(
  `INSERT INTO accounts (email, password_hash, api_key) VALUES (?, ?, ?)`
);
const stmtByEmail = db.prepare(`SELECT * FROM accounts WHERE email = ?`);
const stmtByApiKey = db.prepare(`SELECT * FROM accounts WHERE api_key = ?`);

// ── Password hashing with scrypt ────────────────────────────────
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const hashBuf = Buffer.from(hash, 'hex');
  const derivedBuf = scryptSync(password, salt, 64);
  return timingSafeEqual(hashBuf, derivedBuf);
}

// ── API key generation ──────────────────────────────────────────
function generateApiKey() {
  return `wame_${randomBytes(24).toString('hex')}`;
}

// ── Public API ──────────────────────────────────────────────────
export function registerAccount(email, password) {
  const existing = stmtByEmail.get(email);
  if (existing) throw new Error('Email already registered');

  const passwordHash = hashPassword(password);
  const apiKey = generateApiKey();
  stmtInsert.run(email, passwordHash, apiKey);

  return { email, apiKey };
}

export function loginAccount(email, password) {
  const account = stmtByEmail.get(email);
  if (!account) return null;
  if (!verifyPassword(password, account.password_hash)) return null;
  return { id: account.id, email: account.email, apiKey: account.api_key };
}

export function findByApiKey(apiKey) {
  return stmtByApiKey.get(apiKey) ?? null;
}

// ── Instance ownership ──────────────────────────────────────────
const stmtAssign = db.prepare(
  `INSERT OR IGNORE INTO instance_owners (instance_name, account_id) VALUES (?, ?)`
);
const stmtOwner = db.prepare(
  `SELECT account_id FROM instance_owners WHERE instance_name = ?`
);
const stmtOwnedInstances = db.prepare(
  `SELECT instance_name FROM instance_owners WHERE account_id = ?`
);
const stmtRemoveOwner = db.prepare(
  `DELETE FROM instance_owners WHERE instance_name = ?`
);

export function assignInstance(instanceName, accountId) {
  stmtAssign.run(instanceName, accountId);
}

export function getInstanceOwner(instanceName) {
  return stmtOwner.get(instanceName)?.account_id ?? null;
}

export function getOwnedInstances(accountId) {
  return stmtOwnedInstances.all(accountId).map(r => r.instance_name);
}

export function removeInstanceOwner(instanceName) {
  stmtRemoveOwner.run(instanceName);
}
