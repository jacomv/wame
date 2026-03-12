import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

const WEBHOOKS_DIR = process.env.WEBHOOKS_DIR || './data/webhooks';
const VALID_EVENTS = new Set(['messages', 'group.join', 'group.leave']);
const DISPATCH_TIMEOUT = 5_000;

// Cache en memoria: instance → [ { id, url, events } ]
const store = new Map();

// ── Persistencia ────────────────────────────────────────────────
function filePath(instance) {
  return join(WEBHOOKS_DIR, `${instance}.json`);
}

async function load(instance) {
  if (store.has(instance)) return store.get(instance);
  try {
    const raw = await readFile(filePath(instance), 'utf-8');
    const hooks = JSON.parse(raw);
    store.set(instance, hooks);
    return hooks;
  } catch (err) {
    if (err.code === 'ENOENT') { store.set(instance, []); return []; }
    throw err;
  }
}

async function save(instance) {
  await mkdir(WEBHOOKS_DIR, { recursive: true });
  await writeFile(filePath(instance), JSON.stringify(store.get(instance) || [], null, 2));
}

// ── CRUD ────────────────────────────────────────────────────────
export async function addWebhook(instance, { url, events }) {
  if (!url || typeof url !== 'string') throw new Error('Campo "url" requerido');

  try { new URL(url); } catch { throw new Error('URL inválida'); }

  if (!Array.isArray(events) || !events.length) throw new Error('Campo "events" requerido (array)');
  const invalid = events.filter(e => !VALID_EVENTS.has(e));
  if (invalid.length) throw new Error(`Eventos inválidos: ${invalid.join(', ')}. Válidos: ${[...VALID_EVENTS].join(', ')}`);

  const hooks = await load(instance);
  const hook = { id: randomUUID(), url, events, createdAt: new Date().toISOString() };
  hooks.push(hook);
  await save(instance);
  return hook;
}

export async function listWebhooks(instance) {
  return load(instance);
}

export async function removeWebhook(instance, id) {
  const hooks = await load(instance);
  const idx = hooks.findIndex(h => h.id === id);
  if (idx === -1) return false;
  hooks.splice(idx, 1);
  await save(instance);
  return true;
}

// ── Dispatch (fire-and-forget) ──────────────────────────────────
export async function dispatch(instance, event, data) {
  const hooks = await load(instance);
  const targets = hooks.filter(h => h.events.includes(event));
  if (!targets.length) return;

  const payload = JSON.stringify({
    event,
    instance,
    timestamp: new Date().toISOString(),
    data,
  });

  for (const hook of targets) {
    fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT),
    }).catch(err => {
      console.error(`[webhooks] Error dispatching ${event} to ${hook.url}: ${err.message}`);
    });
  }
}

export { VALID_EVENTS };
