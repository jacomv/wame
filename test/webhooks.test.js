import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';

// Top-level await: env var set + module loaded before any test() runs
const tmpDir = await mkdtemp(join(tmpdir(), 'wame-webhooks-'));
process.env.WEBHOOKS_DIR = tmpDir;
const { addWebhook, listWebhooks, removeWebhook, updateWebhook } = await import('../src/webhooks.js');

after(() => rm(tmpDir, { recursive: true, force: true }));

// ── addWebhook ───────────────────────────────────────────────────

test('addWebhook: creates webhook and returns it with an id', async () => {
  const hook = await addWebhook('inst-create', {
    url: 'https://example.com/hook',
    events: ['messages'],
  });
  assert.ok(hook.id);
  assert.equal(hook.url, 'https://example.com/hook');
  assert.deepEqual(hook.events, ['messages']);
});

test('addWebhook: rejects missing URL', async () => {
  await assert.rejects(
    () => addWebhook('inst-val', { events: ['messages'] }),
    /url/i
  );
});

test('addWebhook: rejects invalid URL', async () => {
  await assert.rejects(
    () => addWebhook('inst-val', { url: 'not-a-url', events: ['messages'] }),
    /URL/
  );
});

test('addWebhook: rejects empty events array', async () => {
  await assert.rejects(
    () => addWebhook('inst-val', { url: 'https://example.com/hook', events: [] }),
    /events/i
  );
});

test('addWebhook: rejects unknown event names', async () => {
  await assert.rejects(
    () => addWebhook('inst-val', { url: 'https://example.com/hook', events: ['bogus'] }),
    /inválidos|invalid/i
  );
});

// ── listWebhooks ─────────────────────────────────────────────────

test('listWebhooks: returns empty array for unknown instance', async () => {
  const hooks = await listWebhooks('inst-empty');
  assert.deepEqual(hooks, []);
});

test('listWebhooks: returns previously added webhooks', async () => {
  await addWebhook('inst-list', { url: 'https://example.com/list', events: ['messages'] });
  const hooks = await listWebhooks('inst-list');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].url, 'https://example.com/list');
});

// ── updateWebhook ────────────────────────────────────────────────

test('updateWebhook: updates URL and events', async () => {
  const hook = await addWebhook('inst-update', {
    url: 'https://example.com/old',
    events: ['messages'],
  });
  const updated = await updateWebhook('inst-update', hook.id, {
    url: 'https://example.com/new',
    events: ['messages', 'group.join'],
  });
  assert.equal(updated.url, 'https://example.com/new');
  assert.deepEqual(updated.events, ['messages', 'group.join']);
  assert.equal(updated.id, hook.id);
});

test('updateWebhook: returns null for non-existent id', async () => {
  const result = await updateWebhook('inst-update', 'does-not-exist', {
    url: 'https://example.com/x',
    events: ['messages'],
  });
  assert.equal(result, null);
});

// ── removeWebhook ────────────────────────────────────────────────

test('removeWebhook: removes existing webhook', async () => {
  const hook = await addWebhook('inst-remove', {
    url: 'https://example.com/remove',
    events: ['messages'],
  });
  const ok = await removeWebhook('inst-remove', hook.id);
  assert.equal(ok, true);
  const remaining = await listWebhooks('inst-remove');
  assert.equal(remaining.length, 0);
});

test('removeWebhook: returns false for non-existent id', async () => {
  const ok = await removeWebhook('inst-remove', 'ghost-id');
  assert.equal(ok, false);
});
