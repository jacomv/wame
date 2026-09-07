// Registro de los retry receipts que pide Baileys por getMessage().
//
// Un mensaje atascado en "Esperando el mensaje" tiene tres causas posibles y
// el arreglo es distinto en cada una:
//
//   1. El retry nunca llega     → no aparece ninguna línea [retry] para ese id
//   2. Llega y no tenemos el original → cache=MISS (bug de caché)
//   3. Llega, reenviamos y vuelve a fallar → el mismo id sube attempt=1,2,3…
//
// El caso 3 es el que no se podía ver antes, y es el importante: Baileys
// reenvía con assertSessions(force), que trae prekeys nuevas y construye la
// sesión desde cero. Si aun así el receptor no descifra, el problema no es la
// criptografía sino a qué dirección Signal se está cifrando — y eso lo delata
// el campo `participant` del receipt, que es lo que `addressing` reporta.

// Espeja el maxMsgRetryCount por omisión de Baileys (Defaults/index.js).
// Al alcanzarlo Baileys deja de reenviar sin decir nada, así que el aviso de
// que se agotó lo tenemos que dar nosotros.
const MAX_MSG_RETRY_COUNT = 5;

// Cota del mapa de intentos. Los retries de un mensaje ocurren en segundos;
// lo que quede vivo más allá de unos cientos de ids es ruido histórico.
const MAX_TRACKED = 500;

const attempts = new Map(); // `${instance}:${msgId}:${participant}` → n

/**
 * Clasifica la dirección Signal a la que se está cifrando.
 *
 * LID es el caso a vigilar: Baileys 6.7.x no tiene mapeo LID↔PN
 * (lib/Signal/ no incluye lid-mapping.js, que sí aparece en 7.0.0-rc), así que
 * un receipt cuyo participant es @lid apunta a un contacto ya migrado y a un
 * reenvío que se cifra contra la dirección equivocada.
 */
export function classifyAddressing(jid) {
  if (typeof jid !== 'string') return 'UNKNOWN';
  if (jid.endsWith('@lid')) return 'LID';
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) return 'PN';
  if (jid.endsWith('@g.us')) return 'GROUP';
  if (jid.endsWith('@newsletter')) return 'NEWSLETTER';
  return 'OTHER';
}

/**
 * Registra una petición de retry y devuelve el número de intento.
 * @returns {{ attempt: number, addressing: string, exhausted: boolean }}
 */
export function recordRetry({ instance, key, cacheHit }) {
  const msgId = key?.id ?? 'unknown';
  const remoteJid = key?.remoteJid ?? null;
  const participant = key?.participant ?? null;

  // El participant es quien no pudo descifrar (en 1:1 coincide con remoteJid,
  // en grupo es el miembro concreto). Es el que importa para el direccionamiento.
  // Si no hay ninguno, `addressing` queda en UNKNOWN en vez de inventarse un
  // JID: un diagnóstico que miente es peor que uno que admite no saber.
  const target = participant ?? remoteJid;
  const addressing = classifyAddressing(target);

  const mapKey = `${instance}:${msgId}:${target ?? 'unknown'}`;
  const attempt = (attempts.get(mapKey) ?? 0) + 1;
  attempts.set(mapKey, attempt);
  while (attempts.size > MAX_TRACKED) {
    attempts.delete(attempts.keys().next().value);
  }

  const exhausted = attempt >= MAX_MSG_RETRY_COUNT;
  const line =
    `[retry] ${instance} msg=${msgId} attempt=${attempt}/${MAX_MSG_RETRY_COUNT} ` +
    `to=${remoteJid ?? '-'} participant=${participant ?? '-'} addressing=${addressing} ` +
    `cache=${cacheHit ? 'HIT' : 'MISS'}`;

  if (!cacheHit) {
    // Sin el original no hay nada que reenviar: ese mensaje se queda atascado.
    console.warn(`${line} — no está en caché, no se puede reenviar`);
  } else if (attempt > 1) {
    // Un segundo intento significa que el reenvío anterior tampoco se descifró.
    console.warn(`${line} — el reenvío anterior no se descifró`);
  } else {
    console.log(line);
  }

  if (exhausted) {
    console.warn(
      `[retry] ${instance} msg=${msgId}: se agotaron los ${MAX_MSG_RETRY_COUNT} reintentos ` +
      `para ${target ?? 'destino desconocido'} (addressing=${addressing}). ` +
      `El mensaje queda en "Esperando el mensaje".` +
      (addressing === 'LID'
        ? ' El destino es @lid y esta versión de Baileys no mapea LID↔PN: causa probable.'
        : '')
    );
  }

  return { attempt, addressing, exhausted };
}

/** Olvida los intentos de una instancia (al eliminarla) */
export function clearRetryLog(instance) {
  const prefix = `${instance}:`;
  for (const key of attempts.keys()) {
    if (key.startsWith(prefix)) attempts.delete(key);
  }
}
