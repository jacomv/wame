# Servidor MCP de WAME

WAME puede funcionar como **servidor MCP remoto**. Así, Claude, ChatGPT y otros agentes pueden usar WhatsApp con las instancias que cada usuario autorice, sin recibir nunca una API key permanente.

- **Transporte:** Streamable HTTP en `POST /mcp`. No hay estado ni sesiones MCP: cada petición se autentica por separado.
- **Autenticación:** OAuth 2.1 con Authorization Code + PKCE (S256), registro dinámico de clientes (RFC 7591), metadatos del servidor (RFC 8414) y del recurso protegido (RFC 9728), indicador de recurso (RFC 8707), `iss` en la redirección (RFC 9207) y revocación (RFC 7009).
- **Autorización:** cada autorización (*grant*) pertenece a una cuenta, a uno o varios permisos y a una lista concreta de instancias.

## Tres credenciales separadas

| Quién | Credencial | Dónde vale |
|---|---|---|
| Panel web | Cookie `wame_session` (HttpOnly, 12 h) | Panel, pantalla de consentimiento |
| Integraciones REST | `x-api-key` (admin o de cuenta) | API REST |
| Clientes MCP | `Authorization: Bearer wame_at_…` (1 h) | Solo `/mcp` |

`/mcp` rechaza la API key y la cookie. La API REST rechaza los tokens MCP. Una cookie del panel nunca sale hacia un cliente MCP: el cliente recibe un código de un solo uso y lo canjea por tokens propios.

## Activarlo

| Variable | Por omisión | Descripción |
|---|---|---|
| `MCP_ENABLED` | `false` | `true` monta OAuth, `/mcp`, la pantalla de consentimiento y "Aplicaciones conectadas". Sin esto, nada cambia. |
| `PUBLIC_URL` | — | URL pública exacta con la que llegan los clientes, por ejemplo `https://wame.example.com`. Es el emisor OAuth y define la audiencia de los tokens (`<PUBLIC_URL>/mcp`). Debe usar https; http solo se admite en localhost. |
| `MCP_ACCESS_TOKEN_TTL` | `3600` | Segundos de vida del access token. |
| `MCP_REFRESH_TOKEN_TTL` | `2592000` | Segundos de vida del refresh token (30 días). Rota en cada uso. |
| `MCP_RATE_LIMIT` | `120` | Peticiones por minuto a `/mcp`, por token. |
| `MCP_SEND_RATE_LIMIT` | `SEND_RATE_LIMIT` o `30` | Envíos por minuto, por autorización. |
| `MCP_REGISTER_RATE_LIMIT` | `20` | Registros de clientes por hora, por IP. |
| `MCP_AUTHORIZE_RATE_LIMIT` | `100` | Peticiones a `/authorize` cada 15 minutos, por IP. |
| `MCP_TOKEN_RATE_LIMIT` | `50` | Peticiones a `/token` y `/revoke` cada 15 minutos, por IP. |
| `MCP_CONSENT_RATE_LIMIT` | `30` | Peticiones por minuto a la API de consentimiento, por IP. |

Detrás de un proxy, `PUBLIC_URL` debe coincidir con el `Host` que llega a WAME, porque `/mcp` rechaza cualquier otro Host para impedir *DNS rebinding*. También hace falta que el proxy envíe `X-Forwarded-Proto` (ver `TRUST_PROXY`).

### Endpoints que se publican

| Ruta | Para qué |
|---|---|
| `/.well-known/oauth-protected-resource/mcp` | Metadatos del recurso (RFC 9728) |
| `/.well-known/oauth-authorization-server` | Metadatos del servidor OAuth (RFC 8414) |
| `/register` | Registro dinámico de clientes |
| `/authorize` | Inicio de la autorización (PKCE S256 obligatorio) |
| `/oauth/consent` | Pantalla donde el usuario inicia sesión y aprueba |
| `/token` | Canje de código y refresh |
| `/revoke` | Revocación por el cliente |
| `/mcp` | Servidor MCP (solo `POST`) |
| `/auth/connected-apps` | API del panel: listar y revocar autorizaciones |

## Permisos

| Permiso | Herramientas |
|---|---|
| `instances:read` | `list_instances`, `get_instance_status` |
| `messages:send` | `send_text`, `send_media` |
| `messages:read` | `list_message_logs` |
| `groups:read` | `list_groups`, `get_group_participants` |
| `contacts:read` | `check_whatsapp_number` |
| `webhooks:read` | `list_webhooks` |

En la pantalla de consentimiento el usuario ve qué cliente pide acceso, con qué cuenta y a qué dominio volverá. Ahí elige:

- **Instancias:** solo puede elegir instancias propias. Las instancias sin dueño, que son del admin, nunca se pueden autorizar.
- **Permisos:** solo puede conceder permisos que el cliente haya pedido. `messages:send` **nunca viene marcado** y hay que activarlo a propósito.

Volver a autorizar el mismo cliente reemplaza la autorización anterior, en vez de sumar otra.

En **cada** llamada, el servidor relee la autorización de la base y comprueba cuatro cosas:

1. que no esté revocada,
2. que tenga el permiso de la herramienta,
3. que la instancia esté en la autorización,
4. que la cuenta siga siendo dueña de la instancia.

Ocultar una herramienta no basta: el servidor la rechaza aunque el cliente la llame. Revocar o reducir permisos tiene efecto en la siguiente petición.

## Herramientas

| Herramienta | Qué hace | Validación |
|---|---|---|
| `list_instances` | Instancias autorizadas y su estado | Nunca devuelve el QR: con él, un tercero podría vincular su teléfono a la instancia |
| `get_instance_status` | Estado y número de una instancia | Igual, sin QR |
| `send_text` | Texto a una persona o grupo | Número de 7 a 15 dígitos o JID `@s.whatsapp.net`, `@g.us` o `@lid`. Máximo 4096 caracteres. No publica en canales |
| `send_media` | Imagen, video, audio o documento desde una URL | Ver "Protección SSRF" |
| `list_groups` / `get_group_participants` | Grupos y participantes | `group_id` debe ser `…@g.us` |
| `check_whatsapp_number` | Si un número usa WhatsApp | Solo números |
| `list_message_logs` | Historial de envíos (sin contenido) | Solo de instancias autorizadas; máximo 100 |
| `list_webhooks` | Webhooks configurados | Sin query string, porque suele llevar secretos |

Herramientas administrativas como conectar, borrar o reiniciar instancias, cambiar webhooks o publicar en canales **no se exponen**.

### Protección SSRF en `send_media`

El texto que lee un agente puede venir de terceros (*prompt injection*). Por eso, antes de que Baileys descargue un archivo:

- solo se aceptan `http` y `https` en los puertos 80 o 443, y sin usuario ni contraseña en la URL;
- el host debe resolver **solo** a direcciones públicas. Se bloquean loopback, redes privadas, link-local (incluido `169.254.169.254`), CGNAT, multicast, rangos reservados e IPv4 mapeadas en IPv6;
- se hace un `HEAD` sin seguir redirecciones automáticamente. Cada salto se valida con las mismas reglas (máximo 3) y a Baileys se le entrega la URL final;
- se comprueban el tipo (`image/*`, `video/*`, `audio/*`) y el tamaño declarado: 16 MB para imagen y audio, 64 MB para video y 100 MB para documentos.

Riesgo que queda: entre la validación y la descarga, el DNS podría cambiar de respuesta (*DNS rebinding*). Para cerrarlo del todo hay que filtrar el tráfico saliente a nivel de red.

## Seguridad y almacenamiento

- **Hash SHA-256 en vez de texto plano** para los secretos de los clientes, los códigos, los access y refresh tokens y los identificadores de las autorizaciones pendientes. Los tokens llevan prefijos (`wame_at_`, `wame_rt_`) para que los escáneres de secretos los detecten.
- **Códigos de un solo uso**, válidos 5 minutos, ligados al cliente, al `redirect_uri` y al recurso.
- **Refresh tokens rotativos.** Si un refresh token ya usado vuelve a aparecer, se revoca la autorización completa (detección de robo).
- **`redirect_uri` permitidas:** https, http solo en loopback y esquemas privados de apps nativas. Nunca `javascript:`, `data:`, `file:` ni URIs con fragmento o credenciales.
- **Auditoría** en la tabla `mcp_audit_log`: registros de cliente, consentimientos, emisión, refresh y revocación de tokens, reusos, accesos denegados y llamadas a herramientas (herramienta, instancia, resultado). **No guarda** el texto de los mensajes, los destinatarios, los tokens ni los secretos. Se purga a los 180 días.
- **Límites de velocidad** por IP en los endpoints OAuth, por token en `/mcp` y por autorización en los envíos.
- **Consentimiento** protegido por la cookie del panel (`SameSite=Strict`), `Origin` del mismo sitio y `frame-ancestors 'self'` contra clickjacking.

## Conectar clientes

En todos los casos la URL es `<PUBLIC_URL>/mcp`. El cliente descubre el resto solo.

- **Claude (claude.ai / Claude Desktop):** Configuración → Conectores → *Agregar conector personalizado* → URL `https://wame.example.com/mcp`. Claude abre la pantalla de consentimiento de WAME.
- **Claude Code:** `claude mcp add --transport http wame https://wame.example.com/mcp` y después `/mcp` para iniciar sesión.
- **ChatGPT:** Configuración → Conectores (modo desarrollador) → crear conector con la misma URL y autenticación OAuth.
- **MCP Inspector:** `npx @modelcontextprotocol/inspector`, transporte *Streamable HTTP*, URL `…/mcp`, y luego *Open Auth Settings* → *Quick OAuth Flow*.
- **Cursor, VS Code y otros:** agrega un servidor MCP remoto (HTTP) con la URL; el cliente hará el OAuth.

Para revocar el acceso: panel de WAME → **Aplicaciones conectadas** → *Revocar*. El efecto es inmediato en el servidor.

## Apagar las aplicaciones de IA de una cuenta

En **Aplicaciones conectadas**, cada cuenta tiene el interruptor **"Permitir aplicaciones de IA en mi cuenta"** (activado por omisión). Al apagarlo:

- el servidor rechaza al instante todos los tokens de esa cuenta (`401` con `invalid_token`), y también el canje de códigos y los refresh;
- la pantalla de consentimiento avisa y no deja autorizar clientes nuevos;
- las autorizaciones **se conservan**. Los refresh tokens no se gastan mientras está apagado, así que al volver a encenderlo cada aplicación sigue funcionando sin tener que reconectarla;
- las demás cuentas no se ven afectadas.

**Revocar todas** borra de una vez todas las autorizaciones de la cuenta y sus tokens. Para volver a usar cualquier aplicación hay que autorizarla desde el principio.

Para apagar el MCP de **todo** el servidor, la vía sigue siendo `MCP_ENABLED=false`.

Ambas acciones quedan en la auditoría (`account_mcp_disabled`, `account_mcp_enabled`, `grants_revoked_all`). API del panel: `PUT /auth/connected-apps/settings` con `{"enabled": true|false}` y `POST /auth/connected-apps/revoke-all`. Las dos exigen la sesión del panel y un `Origin` del mismo sitio.

## Entorno de pruebas aislado

Ver [MCP-TEST-ENVIRONMENT.md](./MCP-TEST-ENVIRONMENT.md).

## Migración y despliegue

### Migración de la base

Al arrancar se crean, si no existen, estas tablas: `oauth_clients`, `oauth_pending_authorizations`, `mcp_grants`, `mcp_grant_instances`, `oauth_authorization_codes`, `oauth_access_tokens`, `oauth_refresh_tokens`, `mcp_audit_log` y `mcp_account_settings` (interruptor por cuenta; sin fila equivale a activado). No se modifica ninguna tabla existente, así que volver a la versión anterior es seguro: las tablas nuevas simplemente se ignoran.

### Pasos

1. **Respaldo** de `wame.db` con el contenedor en marcha:
   ```bash
   docker exec <contenedor> node -e "require('/app/node_modules/better-sqlite3')('/data/wame.db',{readonly:true}).backup('/data/wame-pre-mcp.db').then(()=>console.log('ok'))"
   ```
2. **Desplegar la versión con MCP apagado** (sin `MCP_ENABLED`). La API REST y el panel deben seguir igual. Verifica `/health`, el login del panel y una llamada con `x-api-key`.
3. **Activar MCP** agregando `MCP_ENABLED=true` y `PUBLIC_URL=https://<dominio>`. En el stack de Portainer, agrégalas como variables de entorno y pásalas en el compose:
   ```yaml
   environment:
     MCP_ENABLED: ${MCP_ENABLED:-false}
     PUBLIC_URL: ${PUBLIC_URL:-}
   ```
   Al redesplegar un stack git por la API de Portainer, reenvía **todas** las variables (`API_KEY`, `CORS_ORIGIN`, `MCP_ENABLED`, `PUBLIC_URL`): las que se omitan se borran.
4. **Comprobar:**
   - `curl https://<dominio>/.well-known/oauth-protected-resource/mcp` debe devolver `resource: https://<dominio>/mcp`;
   - `curl -i -X POST https://<dominio>/mcp` debe devolver `401` con `WWW-Authenticate: … resource_metadata=…`;
   - conectar un cliente, aprobar con una instancia de prueba, llamar `list_instances` y revocar desde el panel.
5. **Volver atrás:** quita `MCP_ENABLED`, o despliega la versión anterior. Los tokens dejan de servir porque `/mcp` deja de existir.
