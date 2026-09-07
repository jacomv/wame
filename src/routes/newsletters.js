import { Router } from 'express';
import { requireApiKey } from '../auth.js';
import { validateInstanceName, isNewsletterJid, parseNewsletterInvite } from '../utils/jid.js';
import { requireOwnership, sendLimiter } from '../utils/guards.js';
import { getSocket } from '../manager.js';
import { sendMessage } from '../sender.js';
import { logMessage } from '../logger.js';
import {
  canPublish,
  fetchNewsletter,
  trackNewsletter,
  untrackNewsletter,
  isTracked,
  listNewslettersWithMetadata,
} from '../newsletters.js';

const router = Router();

/** Resuelve el socket de la instancia o responde 503 */
function socketOr503(req, res) {
  const sock = getSocket(req.params.name);
  if (!sock) {
    res.status(503).json({ error: `Instancia "${req.params.name}" no conectada` });
    return null;
  }
  return sock;
}

/**
 * Valida el :jid de la ruta. Va en su propio middleware porque el JID entra en
 * consultas SQL y en el JID de destino de un envío, y un formato raro debe
 * cortarse antes de llegar a cualquiera de los dos.
 */
function validateNewsletterParam(req, res, next) {
  if (!isNewsletterJid(req.params.jid)) {
    return res.status(400).json({ error: 'JID de canal inválido. Formato esperado: <id>@newsletter' });
  }
  next();
}

const base = '/:name/newsletters';
const guards = [requireApiKey, validateInstanceName, requireOwnership];

// ── Listar canales registrados ──────────────────────────────────
// Baileys no puede enumerar los canales de una cuenta (ver src/newsletters.js),
// así que esto lista los que se dieron de alta y refresca sus metadatos.
router.get(base, ...guards, async (req, res) => {
  const sock = socketOr503(req, res);
  if (!sock) return;
  try {
    res.json(await listNewslettersWithMetadata(sock, req.params.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Registrar un canal por JID o por invitación ─────────────────
router.post(base, ...guards, async (req, res) => {
  const { jid, invite } = req.body ?? {};
  if (!jid && !invite) {
    return res.status(400).json({ error: 'Se requiere "jid" (<id>@newsletter) o "invite" (código o enlace whatsapp.com/channel/...)' });
  }

  let lookup;
  if (jid) {
    if (!isNewsletterJid(jid)) {
      return res.status(400).json({ error: 'JID de canal inválido. Formato esperado: <id>@newsletter' });
    }
    lookup = { jid: jid.trim() };
  } else {
    const code = parseNewsletterInvite(invite);
    if (!code) return res.status(400).json({ error: 'Código de invitación inválido' });
    lookup = { invite: code };
  }

  const sock = socketOr503(req, res);
  if (!sock) return;

  try {
    const meta = await fetchNewsletter(sock, lookup);
    if (!meta) return res.status(404).json({ error: 'Canal no encontrado o no visible para esta cuenta' });

    trackNewsletter(req.params.name, meta);
    res.status(201).json({ ...meta, canPublish: canPublish(meta.role) });
  } catch (err) {
    res.status(502).json({ error: `WhatsApp rechazó la consulta del canal: ${err.message}` });
  }
});

// ── Metadatos de un canal ───────────────────────────────────────
// No exige que esté registrado: sirve para inspeccionar un canal antes de darlo
// de alta y ver qué rol tiene la cuenta en él.
router.get(`${base}/:jid`, ...guards, validateNewsletterParam, async (req, res) => {
  const sock = socketOr503(req, res);
  if (!sock) return;
  try {
    const meta = await fetchNewsletter(sock, { jid: req.params.jid });
    if (!meta) return res.status(404).json({ error: 'Canal no encontrado o no visible para esta cuenta' });
    res.json({ ...meta, canPublish: canPublish(meta.role), tracked: isTracked(req.params.name, req.params.jid) });
  } catch (err) {
    res.status(502).json({ error: `WhatsApp rechazó la consulta del canal: ${err.message}` });
  }
});

// ── Publicar en un canal ────────────────────────────────────────
// Comparte sendLimiter con POST /:name/send a propósito: si tuviera su propio
// cupo, los canales serían una vía para duplicar el límite de envío.
router.post(`${base}/:jid/send`, ...guards, validateNewsletterParam, sendLimiter, async (req, res) => {
  const { name, jid } = req.params;
  const { type, ...payload } = req.body ?? {};
  if (!type) return res.status(400).json({ error: 'Falta campo: type' });

  const sock = socketOr503(req, res);
  if (!sock) return;

  // Un SUBSCRIBER que publique recibe un error opaco del servidor de WhatsApp;
  // comprobar el rol primero da un 403 que se entiende. Se consulta en vivo y
  // no desde el registro porque el rol puede haber cambiado desde el alta.
  let role = null;
  try {
    const meta = await fetchNewsletter(sock, { jid });
    if (!meta) return res.status(404).json({ error: 'Canal no encontrado o no visible para esta cuenta' });
    role = meta.role;
  } catch (err) {
    return res.status(502).json({ error: `No se pudo verificar el canal: ${err.message}` });
  }

  if (!canPublish(role)) {
    return res.status(403).json({
      error: `Esta cuenta no puede publicar en el canal (rol: ${role ?? 'desconocido'}). Se requiere ADMIN u OWNER.`,
    });
  }

  try {
    await sendMessage(sock, jid, type, payload);
    logMessage({ instance: name, to: jid, type, status: 'ok' });
    res.json({ ok: true });
  } catch (err) {
    logMessage({ instance: name, to: jid, type, status: 'error', error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── Quitar un canal del registro ────────────────────────────────
// Solo lo borra de WAME: la cuenta sigue siguiendo el canal en WhatsApp.
router.delete(`${base}/:jid`, ...guards, validateNewsletterParam, (req, res) => {
  if (!untrackNewsletter(req.params.name, req.params.jid)) {
    return res.status(404).json({ error: 'El canal no está registrado en esta instancia' });
  }
  res.json({ ok: true });
});

export default router;
