# Guía de pruebas del PR #28 — endurecimiento de autenticación

Esta guía se ejecuta **exclusivamente sobre la rama `security/auth-hardening-pr`**. No modifica `main`, no publica versiones y no necesita una conexión real de WhatsApp.

## 1. Preparar el entorno aislado

Requisitos: Git, Docker y Docker Compose v2. Debe estar libre el puerto **3100** del equipo de pruebas.

```bash
git clone https://github.com/jacomv/wame.git wame-auth-test
cd wame-auth-test
git switch security/auth-hardening-pr
export WAME_TEST_API_KEY="$(openssl rand -hex 32)"
docker compose -f docker-compose.test.yml up --build -d
docker compose -f docker-compose.test.yml ps
curl -fsS http://127.0.0.1:3100/health
```

Abre **http://localhost:3100** en el navegador del mismo equipo. El puerto se publica solo en `127.0.0.1`, no en la red pública. Se usa un volumen exclusivo `wame_pr28_auth_test_data`, **nunca** el volumen `wame_data` de producción. No copies credenciales de WhatsApp, `.env`, tokens ni sesiones de producción.

Si ejecutas el servicio en un VPS remoto, accede por un túnel SSH en vez de exponer el puerto:

```bash
ssh -L 3100:127.0.0.1:3100 usuario@servidor-de-pruebas
```

No ejecutes este compose en el mismo proyecto Docker de producción ni cambies su configuración.

## 2. Pruebas automatizadas

```bash
npm ci
npm test
```

**Criterio:** todas las pruebas pasan. Consulta también el CI de GitHub Actions del último commit del PR.

## 3. Lista de aceptación manual

Marca cada prueba solo después de comprobarla.

- [ ] **Arranque:** `/health` devuelve HTTP 200.
- [ ] **Primer usuario:** el panel permite crear la primera cuenta con contraseña de al menos 12 caracteres.
- [ ] **Registro cerrado:** después de la primera cuenta, desaparece la opción de registro y `POST /auth/register` devuelve 403 sin autorización de administrador.
- [ ] **Contraseña corta:** se rechazan menos de 12 caracteres.
- [ ] **Login:** correo y contraseña correctos permiten entrar; credenciales erróneas devuelven 401.
- [ ] **Sin API key en navegador:** no existe pestaña de acceso con API key y la respuesta de `/auth/login` no devuelve `apiKey`.
- [ ] **Cookie:** en DevTools, la cookie `wame_session` tiene `HttpOnly`, `SameSite=Strict` y duración de 12 horas. En HTTP local no tendrá `Secure`; comprobar `Secure` por separado en HTTPS.
- [ ] **Recarga:** actualizar el navegador mantiene la sesión mientras no haya expirado.
- [ ] **Logout:** cerrar sesión impide recuperar `/auth/session` con la cookie anterior (401).
- [ ] **Autorización:** sin sesión ni API key, `GET /status` devuelve 401.
- [ ] **CSRF:** un POST autenticado solo con cookie y `Origin` ajeno devuelve 403. También se rechaza cuando falta `Origin`.
- [ ] **API key de integración:** la API key de administrador de pruebas sigue autenticando con `x-api-key` sin cookie.
- [ ] **Rotación:** con sesión válida, botón **Rotate API key** abre un modal con contraseña enmascarada; contraseña errónea muestra el error en el modal, contraseña correcta muestra una clave una sola vez con botón **Copiar**. La clave anterior de la cuenta deja de funcionar. No rotar la clave global `WAME_TEST_API_KEY` (es distinta).
- [ ] **Instancias:** una cuenta no puede ver, modificar ni reclamar una instancia existente de otra cuenta o sin propietario. Usar instancias ficticias; **no conectar WhatsApp real**.
- [ ] **Resistencia:** entradas malformadas en login y registro devuelven 400, sin errores 500 ni caída del servidor. Un JSON roto devuelve `{"error":"JSON inválido"}` sin stack trace.
- [ ] **Fuerza bruta por cuenta:** 10 logins fallidos para el mismo email en 15 minutos devuelven 429 aunque cambie la IP o el `X-Forwarded-For`.
- [ ] **Persistencia:** reiniciar el contenedor conserva las cuentas en el volumen de pruebas.
- [ ] **Logs:** no aparecen contraseñas, claves API completas ni tokens de sesión en logs del servidor.

## 4. Pruebas de API reproducibles

```bash
BASE=http://127.0.0.1:3100

# Sin credenciales -> 401
curl -i "$BASE/status"

# Administrador de pruebas -> 200
curl -i -H "x-api-key: $WAME_TEST_API_KEY" "$BASE/status"

# Registrar primer usuario (solo una vez por volumen nuevo)
curl -i -c /tmp/wame-test-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"prueba@example.test","password":"UnaClaveDePrueba123!"}' \
  "$BASE/auth/register"

# Consultar sesión con cookie
curl -i -b /tmp/wame-test-cookie.txt "$BASE/auth/session"

# Intento CSRF: debe devolver 403
curl -i -b /tmp/wame-test-cookie.txt \
  -H 'Origin: https://sitio-ajeno.example' \
  -H 'Content-Type: application/json' \
  -d '{}' "$BASE/instances/ejemplo/connect"
```

La última prueba debe responder **403 antes de intentar conectar**. Si el primer registro ya se realizó desde el navegador, usa `/auth/login` con la cuenta creada para obtener la cookie.

## 5. Migración desde 1.7.0

La migración de API keys es **unidireccional**. Nunca pruebes sobre la base de datos de producción.

1. Haz un respaldo consistente de `wame.db` de una instalación **ficticia** de la versión 1.7.0.
2. Detén el contenedor de pruebas y coloca **solo ese archivo SQLite** en su volumen de pruebas, sin copiar sesiones de WhatsApp.
3. Arranca el contenedor del PR y confirma que las claves antiguas siguen autenticando con `x-api-key`.
4. Comprueba que la columna `accounts.api_key` ya contiene hashes de 64 caracteres hexadecimales y no secretos legibles.
5. Verifica que el login con contraseñas anteriores sigue funcionando.
6. Comprueba que la rotación invalida inmediatamente la clave anterior.
7. No intentes hacer downgrade sobre esa misma base migrada; restaura la copia previa si necesitas volver a 1.7.0.

## 6. Limpiar el entorno

```bash
docker compose -f docker-compose.test.yml down
```

Para borrar también **todos los datos de prueba**:

```bash
docker compose -f docker-compose.test.yml down -v
rm -f /tmp/wame-test-cookie.txt
```

**Atención:** `down -v` elimina las cuentas y los datos del volumen de pruebas. No lo ejecutes sobre el compose de producción.

## 7. Criterios para aprobar el PR

- [ ] CI del último commit aprobado.
- [ ] Todas las pruebas manuales anteriores aprobadas.
- [ ] Migración de SQLite probada sobre datos ficticios de 1.7.0.
- [ ] Revisión del proxy HTTPS, encabezado `Origin` y cookies `Secure`.
- [ ] Respaldo y plan de recuperación documentados.
- [ ] Aprobación explícita del propietario antes de fusionar o publicar.

Registra fallos con pasos de reproducción, código HTTP y logs **sin secretos** en el PR #28: https://github.com/jacomv/wame/pull/28.
