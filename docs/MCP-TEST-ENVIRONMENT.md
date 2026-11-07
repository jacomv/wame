# Entorno aislado para probar el servidor MCP

Este entorno no usa producción, credenciales reales ni WhatsApp. Escucha solo en `127.0.0.1:3200` y guarda los datos en el volumen `wame_mcp_test_data`.

## 1. Levantar

```bash
export WAME_TEST_API_KEY="$(openssl rand -hex 32)"
docker compose -p wame-mcp -f docker-compose.mcp-test.yml up --build -d
curl -fsS http://localhost:3200/health
```

`PUBLIC_URL` es `http://localhost:3200`. Usa siempre `localhost`, no `127.0.0.1`: `/mcp` rechaza cualquier otro `Host`.

## 2. Cuenta e instancia ficticia

```bash
# Cuenta de prueba (el registro público está cerrado tras la primera cuenta)
curl -s -H "x-api-key: $WAME_TEST_API_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"mcp@example.test","password":"ClaveDePruebaMcp123"}' http://localhost:3200/auth/register

# Instancia "demo" para esa cuenta, sin conectar WhatsApp
docker exec wame-mcp-wame-mcp-test-1 node -e "const db=require('/app/node_modules/better-sqlite3')('/data/wame.db');const id=db.prepare('SELECT id FROM accounts WHERE email=?').get('mcp@example.test').id;db.prepare('INSERT OR IGNORE INTO instance_owners (instance_name, account_id) VALUES (?,?)').run('demo',id)"
```

Las herramientas de lectura responden con `demo` en estado `not_loaded`. Los envíos responden "Instancia no conectada", lo que confirma que la petición atravesó OAuth, los permisos y la propiedad antes de llegar al backend.

## 3. Pruebas automatizadas

```bash
npm ci
npm test
```

| Archivo | Qué cubre |
|---|---|
| `tests/mcp.test.js` | Descubrimiento, registro de clientes, PKCE, consentimiento, tokens inválidos, vencidos y revocados, rotación y reuso de refresh tokens, permisos insuficientes, aislamiento entre cuentas, revocación desde el panel, herramientas MCP con el cliente del SDK, *DNS rebinding* y compatibilidad REST |
| `tests/mcp-media.test.js` | Protección SSRF, redirecciones, tamaños y tipos; `redirect_uri` permitidas |

## 4. Cliente MCP real (OAuth completo en un navegador)

`scripts/mcp-e2e.mjs` usa el cliente oficial del SDK de MCP y Chromium. El script:

1. recibe el 401;
2. descubre los metadatos;
3. se registra;
4. abre la pantalla de consentimiento, inicia sesión, concede `instances:read` y `messages:send` sobre `demo`;
5. canjea el código, llama herramientas y rota el refresh token.

```bash
npm i --no-save playwright   # o PLAYWRIGHT_PATH=/ruta/a/node_modules/playwright
E2E_EMAIL=mcp@example.test E2E_PASSWORD=ClaveDePruebaMcp123 node scripts/mcp-e2e.mjs
```

El script se niega a correr contra el dominio de producción. Al final imprime un `ACCESS_TOKEN_FOR_INSPECTOR` para probar con otro cliente:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:3200/mcp --transport http \
  --header "Authorization: Bearer <token>" --method tools/list
```

También puedes usar MCP Inspector en modo gráfico (`npx @modelcontextprotocol/inspector`, *Quick OAuth Flow*) o Claude Code (`claude mcp add --transport http wame-test http://localhost:3200/mcp`).

## 5. Lista manual

- [ ] `GET /.well-known/oauth-protected-resource/mcp` devuelve `resource: http://localhost:3200/mcp`.
- [ ] `POST /mcp` sin token devuelve 401 con `resource_metadata`.
- [ ] La pantalla de consentimiento pide iniciar sesión y muestra el cliente, la cuenta y el dominio de retorno.
- [ ] Solo aparecen instancias propias; `messages:send` no viene marcado.
- [ ] El token concedido solo lista las herramientas de los permisos elegidos.
- [ ] `send_media` con `http://169.254.169.254/...` se rechaza.
- [ ] Otra cuenta no ve ni puede revocar la aplicación.
- [ ] En **Aplicaciones conectadas** aparecen los permisos, las instancias, el último uso y la última acción. *Revocar* deja el token en 401 al instante.
- [ ] `x-api-key` sigue funcionando en la API REST y no sirve en `/mcp`.

## 6. Limpiar

```bash
docker compose -p wame-mcp -f docker-compose.mcp-test.yml down -v
```
