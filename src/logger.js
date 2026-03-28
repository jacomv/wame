import db from './db.js';

const stmtInsert = db.prepare(
  `INSERT INTO message_logs (instance, "to", type, status, error) VALUES (?, ?, ?, ?, ?)`
);

const stmtSelectAll = db.prepare(
  `SELECT * FROM message_logs ORDER BY created_at DESC LIMIT ?`
);

const stmtSelectByInstance = db.prepare(
  `SELECT * FROM message_logs WHERE instance = ? ORDER BY created_at DESC LIMIT ?`
);

const stmtSelectByInstances = (names) => {
  if (!names.length) return [];
  const placeholders = names.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM message_logs WHERE instance IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`
  ).all(...names);
};

export function logMessage({ instance, to, type, status, error = null }) {
  try {
    stmtInsert.run(instance, to, type, status, error);
  } catch (err) {
    console.error('[logger] Error guardando log:', err.message);
  }
}

export function getLogs({ instance, limit = 20, instanceNames = null }) {
  // If filtering by owned instances
  if (instanceNames) {
    if (!instanceNames.length) return [];
    const placeholders = instanceNames.map(() => '?').join(',');
    return db.prepare(
      `SELECT * FROM message_logs WHERE instance IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`
    ).all(...instanceNames, limit);
  }
  if (instance) {
    return stmtSelectByInstance.all(instance, limit);
  }
  return stmtSelectAll.all(limit);
}
