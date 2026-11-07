// Herramientas MCP. Cada llamada relee el grant de la base y exige el permiso,
// que la instancia esté en el grant y que la cuenta siga siendo su dueña. No
// basta con no listar una herramienta: el servidor rechaza cualquier otra cosa.
import * as z from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getInstanceOwner } from '../accounts.js';
import { getInstanceStatus } from '../manager.js';
import { getLogs } from '../logger.js';
import { listWebhooks } from '../webhooks.js';
import {
  ServiceError, sendToInstance, listGroups, listGroupParticipants, checkNumber,
} from '../services/instances.js';
import { checkMediaUrl, MediaUrlError } from './media.js';
import * as store from './store.js';

class AccessError extends Error {}

const instanceName = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Nombre de instancia inválido')
  .describe('Name of an instance this authorization can use (see list_instances)');
const recipient = z.string().min(3).max(64)
  .describe('Phone number in international format (e.g. 573001234567) or a WhatsApp JID (…@s.whatsapp.net, …@g.us)');

// ── Límite de envíos por autorización (ventana deslizante en memoria) ──
const sendWindows = new Map();
function takeSendSlot(grantId, max) {
  const now = Date.now();
  const recent = (sendWindows.get(grantId) || []).filter(t => now - t < 60_000);
  if (recent.length >= max) {
    sendWindows.set(grantId, recent);
    return false;
  }
  recent.push(now);
  sendWindows.set(grantId, recent);
  return true;
}

/** Autoriza una llamada: grant vigente, permiso y, si aplica, instancia propia y autorizada. */
export function authorizeCall(authInfo, scope, instance) {
  const grantId = authInfo?.extra?.grantId;
  const grant = grantId ? store.getGrant(grantId) : null;
  if (!grant || grant.revokedAt) throw new AccessError('La autorización fue revocada');
  if (!grant.scopes.includes(scope)) throw new AccessError(`Esta autorización no tiene el permiso ${scope}`);
  if (instance !== undefined) {
    if (!grant.instances.includes(instance)) {
      throw new AccessError(`La instancia "${instance}" no está autorizada para este cliente`);
    }
    if (getInstanceOwner(instance) !== grant.accountId) {
      throw new AccessError(`La instancia "${instance}" ya no pertenece a esta cuenta`);
    }
  }
  return grant;
}

/** Instancias del grant que la cuenta todavía posee. */
function usableInstances(grant) {
  return grant.instances.filter(name => getInstanceOwner(name) === grant.accountId);
}

/** Estado sin el QR: con él un tercero podría vincular su WhatsApp a la instancia. */
function publicStatus(name) {
  const s = getInstanceStatus(name);
  return s
    ? { name, status: s.status, phone: s.phone ?? null, connectedAt: s.connectedAt ?? null }
    : { name, status: 'not_loaded', phone: null, connectedAt: null };
}

const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = message => ({ isError: true, content: [{ type: 'text', text: message }] });

const TOOLS = [
  {
    name: 'list_instances',
    scope: 'instances:read',
    title: 'List authorized instances',
    description: 'Lists the WhatsApp instances this connection may use, with their connection status.',
    input: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (_args, { grant }) => ok({ instances: usableInstances(grant).map(publicStatus) }),
  },
  {
    name: 'get_instance_status',
    scope: 'instances:read',
    title: 'Get instance status',
    description: 'Returns the connection status and phone number of one authorized instance.',
    input: { instance: instanceName },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ instance }) => ok(publicStatus(instance)),
  },
  {
    name: 'send_text',
    scope: 'messages:send',
    title: 'Send a text message',
    description: 'Sends a WhatsApp text message from an authorized instance to a person or group.',
    input: {
      instance: instanceName,
      to: recipient,
      text: z.string().min(1).max(4096).describe('Message text (max 4096 characters)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    send: true,
    run: async ({ instance, to, text }) =>
      ok(await sendToInstance(instance, { to, type: 'text', text }, { allowNewsletter: false })),
  },
  {
    name: 'send_media',
    scope: 'messages:send',
    title: 'Send an image, video, audio or document',
    description: 'Sends media from a public http(s) URL. The server checks the URL (public host, size, content type) before sending.',
    input: {
      instance: instanceName,
      to: recipient,
      type: z.enum(['image', 'video', 'audio', 'document']).describe('Kind of media'),
      url: z.string().url().max(2048).describe('Public http(s) URL of the file'),
      caption: z.string().max(1024).optional().describe('Caption (image, video, document)'),
      filename: z.string().max(128).regex(/^[^/\\\0]+$/, 'Nombre de archivo inválido').optional().describe('File name shown for documents'),
      mimetype: z.string().max(100).regex(/^[\w.+-]+\/[\w.+-]+$/, 'mimetype inválido').optional(),
      voice_note: z.boolean().optional().describe('Audio only: send as a voice note'),
      gif_playback: z.boolean().optional().describe('Video only: play as a looping GIF'),
      video_note: z.boolean().optional().describe('Video only: send as a round video note (no caption)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    send: true,
    run: async ({ instance, to, type, url, caption, filename, mimetype, voice_note, gif_playback, video_note }) => {
      const checked = await checkMediaUrl(url, type);
      const payload = { to, type, url: checked.url };
      if (caption !== undefined && type !== 'audio') payload.caption = caption;
      if (mimetype) payload.mimetype = mimetype;
      if (type === 'document') payload.filename = filename ?? 'archivo';
      if (type === 'audio' && voice_note !== undefined) payload.ptt = voice_note;
      if (type === 'video') {
        if (gif_playback !== undefined) payload.gifPlayback = gif_playback;
        if (video_note !== undefined) payload.ptv = video_note;
      }
      return ok(await sendToInstance(instance, payload, { allowNewsletter: false }));
    },
  },
  {
    name: 'list_groups',
    scope: 'groups:read',
    title: 'List groups',
    description: 'Lists the WhatsApp groups the instance participates in.',
    input: { instance: instanceName },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async ({ instance }) => ok({ groups: await listGroups(instance) }),
  },
  {
    name: 'get_group_participants',
    scope: 'groups:read',
    title: 'Get group participants',
    description: 'Lists the participants of a group (phone/JID and admin role).',
    input: {
      instance: instanceName,
      group_id: z.string().regex(/^[\d-]{5,64}@g\.us$/, 'group_id debe ser un JID de grupo (…@g.us)').describe('Group JID from list_groups'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async ({ instance, group_id }) => ok({ participants: await listGroupParticipants(instance, group_id) }),
  },
  {
    name: 'check_whatsapp_number',
    scope: 'contacts:read',
    title: 'Check a phone number',
    description: 'Checks whether a phone number is registered on WhatsApp.',
    input: {
      instance: instanceName,
      number: z.string().regex(/^\+?[\d\s()-]{7,20}$/, 'Número inválido').describe('Phone number in international format'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async ({ instance, number }) => ok(await checkNumber(instance, number)),
  },
  {
    name: 'list_message_logs',
    scope: 'messages:read',
    title: 'List sent-message history',
    description: 'Returns recent send attempts (recipient, type, status, error) for the authorized instances. Message content is not stored.',
    input: {
      instance: instanceName.optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Max entries (default 20)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    optionalInstance: true,
    run: async ({ instance, limit = 20 }, { grant }) => {
      const names = instance ? [instance] : usableInstances(grant);
      return ok({ logs: getLogs({ instanceNames: names, limit }) });
    },
  },
  {
    name: 'list_webhooks',
    scope: 'webhooks:read',
    title: 'List webhooks',
    description: 'Lists the webhooks configured for an instance. Query strings are removed because they often carry secrets.',
    input: { instance: instanceName },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async ({ instance }) => {
      const hooks = await listWebhooks(instance);
      return ok({
        webhooks: hooks.map(h => {
          let url = '(inválida)';
          try { const u = new URL(h.url); url = u.origin + u.pathname; } catch { /* se deja el marcador */ }
          return { id: h.id, url, events: h.events };
        }),
      });
    },
  },
];

export const TOOL_SCOPES = Object.fromEntries(TOOLS.map(t => [t.name, t.scope]));

/**
 * Crea el servidor MCP de una petición. Solo se listan las herramientas que el
 * grant permite, pero cada handler vuelve a autorizar por su cuenta.
 */
export function createMcpServer({ grant, config, version }) {
  const server = new McpServer(
    { name: 'wame', title: 'WAME — WhatsApp', version },
    { instructions: 'Use list_instances first. Only the instances and permissions the user approved are available.' },
  );

  for (const tool of TOOLS) {
    if (!grant.scopes.includes(tool.scope)) continue;
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: tool.annotations,
    }, async (args, extra) => {
      const instance = args?.instance;
      let current;
      try {
        current = authorizeCall(extra.authInfo, tool.scope, tool.optionalInstance && instance === undefined ? undefined : instance);
      } catch (err) {
        store.audit('access_denied', {
          accountId: grant.accountId, grantId: grant.id, clientId: grant.clientId,
          instance: instance ?? null, tool: tool.name, outcome: 'denied', detail: err.message,
        });
        return fail(err.message);
      }

      if (tool.send && !takeSendSlot(current.id, config.sendRateLimit)) {
        store.audit('tool_call', { accountId: current.accountId, grantId: current.id, clientId: current.clientId, instance, tool: tool.name, outcome: 'rate_limited' });
        return fail(`Límite de ${config.sendRateLimit} envíos por minuto alcanzado. Intenta más tarde.`);
      }

      store.touchGrant(current.id);
      try {
        const result = await tool.run(args, { grant: current });
        store.audit('tool_call', { accountId: current.accountId, grantId: current.id, clientId: current.clientId, instance: instance ?? null, tool: tool.name, outcome: 'ok' });
        return result;
      } catch (err) {
        const known = err instanceof ServiceError || err instanceof MediaUrlError;
        const message = known ? err.message : 'Error interno';
        if (!known) console.error(`[mcp] ${tool.name}: ${err.message}`);
        store.audit('tool_call', { accountId: current.accountId, grantId: current.id, clientId: current.clientId, instance: instance ?? null, tool: tool.name, outcome: 'error', detail: message });
        return fail(message);
      }
    });
  }
  return server;
}
