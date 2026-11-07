// Permisos que un cliente MCP puede pedir. Cada herramienta exige uno, y el
// servidor lo comprueba en cada llamada junto con la propiedad de la instancia.
export const SCOPES = {
  'instances:read': {
    en: 'See the selected instances and their connection status',
    es: 'Ver las instancias seleccionadas y su estado de conexión',
  },
  'messages:send': {
    en: 'Send messages and media from the selected instances',
    es: 'Enviar mensajes y archivos desde las instancias seleccionadas',
  },
  'messages:read': {
    en: 'Read the history of sent messages (recipient, type, status)',
    es: 'Consultar el historial de envíos (destinatario, tipo, estado)',
  },
  'groups:read': {
    en: 'List groups and their participants',
    es: 'Ver los grupos y sus participantes',
  },
  'contacts:read': {
    en: 'Check whether a phone number uses WhatsApp',
    es: 'Comprobar si un número usa WhatsApp',
  },
  'webhooks:read': {
    en: 'See the configured webhooks (without query strings)',
    es: 'Ver los webhooks configurados (sin parámetros de la URL)',
  },
};

export const SCOPE_NAMES = Object.keys(SCOPES);

export function isValidScope(scope) {
  return Object.hasOwn(SCOPES, scope);
}

/** Normaliza una lista de scopes: sin duplicados, en el orden canónico. */
export function normalizeScopes(list) {
  const set = new Set(list);
  return SCOPE_NAMES.filter(s => set.has(s));
}
