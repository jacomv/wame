# Documentación de la API — WAME

Guía completa para integrar cualquier servicio con la API de WAME y enviar mensajes por WhatsApp.

---

## Autenticación

Todas las peticiones requieren el header `x-api-key` con la clave configurada en la variable de entorno `API_KEY`.

```
x-api-key: tu-api-key-segura
```

Si la clave es inválida o no se envía, la API responde con:

```json
{ "error": "Unauthorized" }
```

**HTTP Status:** `401`

---

## Flujo de integración

```
┌─────────────────┐     ┌──────────┐     ┌──────────┐
│  Tu Servicio    │────▸│  WAME    │────▸│ WhatsApp │
│  (CRM, ERP,    │ API │  API     │     │          │
│   Bot, etc.)   │◂────│          │     │          │
└─────────────────┘     └──────────┘     └──────────┘
```

### Pasos para integrar

1. **Despliega WAME** y configura las variables de entorno.
2. **Crea una instancia** con `POST /instances/:name/connect`.
3. **Escanea el QR** que devuelve la API con la app de WhatsApp.
4. **Verifica la conexión** con `GET /instances/:name/status`.
5. **Envía mensajes** con `POST /instances/:name/send`.

---

## Endpoints

### 1. Estado general

```
GET /status
```

Devuelve el estado de todas las instancias registradas.

**Respuesta:**

```json
{
  "instances": [
    {
      "name": "ventas",
      "status": "connected",
      "phone": "5491155551234",
      "connectedAt": "2025-01-15T10:30:00.000Z"
    },
    {
      "name": "soporte",
      "status": "qr",
      "phone": null,
      "connectedAt": null
    }
  ]
}
```

**Estados posibles:** `connecting`, `qr`, `connected`, `logged_out`, `disconnected`

---

### 2. Conectar instancia

```
POST /instances/:name/connect
```

Crea o reconecta una instancia de WhatsApp. Si es la primera vez, devuelve un código QR para escanear.

**Parámetros de URL:**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `name` | string | Identificador único de la instancia (alfanumérico y guiones) |

**Respuesta (nueva instancia):**

```json
{
  "status": "qr",
  "qr": "data:image/png;base64,iVBORw0KGgo..."
}
```

**Respuesta (instancia existente reconectada):**

```json
{
  "status": "connected"
}
```

**Ejemplo:**

```bash
curl -X POST http://localhost:3000/instances/ventas/connect \
  -H "x-api-key: tu-api-key"
```

---

### 3. Estado de instancia

```
GET /instances/:name/status
```

Devuelve el estado detallado de una instancia, incluyendo el QR si está pendiente de escaneo.

**Respuesta:**

```json
{
  "name": "ventas",
  "status": "connected",
  "qr": null,
  "phone": "5491155551234",
  "connectedAt": "2025-01-15T10:30:00.000Z"
}
```

---

### 4. Enviar mensaje

```
POST /instances/:name/send
```

Envía un mensaje a un número de teléfono o grupo de WhatsApp.

**Headers:**

```
Content-Type: application/json
x-api-key: tu-api-key
```

**Campos del body:**

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `to` | string | Sí | Número de teléfono (ej: `5491155551234`) o ID de grupo (`id@g.us`). El sufijo `@s.whatsapp.net` se agrega automáticamente si no se incluye |
| `type` | string | Sí | Tipo de mensaje: `text`, `image`, `audio`, `document` |
| `text` | string | Solo para `text` | Contenido del mensaje de texto |
| `url` | string | Solo para media | URL del archivo (imagen, audio, documento) |
| `caption` | string | No | Pie de foto (solo para `image`) |
| `filename` | string | No | Nombre del archivo (solo para `document`) |
| `mimetype` | string | No | Tipo MIME del archivo (solo para `document`, default: `application/octet-stream`) |
| `ptt` | boolean | No | Enviar como nota de voz (solo para `audio`, default: `false`) |

**Formato del campo `to`:**

- **Contactos individuales:** solo el número con código de país, sin `+` ni espacios
  - Ejemplo: `5491155551234` (Argentina), `521555123456` (México), `34612345678` (España)
  - También acepta el formato completo: `5491155551234@s.whatsapp.net`
- **Grupos:** usa el ID del grupo tal como lo devuelve el endpoint `/groups`
  - Ejemplo: `120363012345678901@g.us`

#### Enviar texto

```bash
curl -X POST http://localhost:3000/instances/ventas/send \
  -H "x-api-key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5491155551234",
    "type": "text",
    "text": "Hola, tu pedido #1234 ha sido enviado."
  }'
```

#### Enviar imagen

```bash
curl -X POST http://localhost:3000/instances/ventas/send \
  -H "x-api-key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5491155551234",
    "type": "image",
    "url": "https://ejemplo.com/factura.png",
    "caption": "Tu factura del mes de enero"
  }'
```

#### Enviar audio

```bash
curl -X POST http://localhost:3000/instances/ventas/send \
  -H "x-api-key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5491155551234",
    "type": "audio",
    "url": "https://ejemplo.com/mensaje.mp3",
    "ptt": true
  }'
```

#### Enviar documento

```bash
curl -X POST http://localhost:3000/instances/ventas/send \
  -H "x-api-key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5491155551234",
    "type": "document",
    "url": "https://ejemplo.com/reporte.pdf",
    "filename": "reporte-enero-2025.pdf",
    "mimetype": "application/pdf"
  }'
```

**Respuesta exitosa:**

```json
{ "ok": true }
```

**Errores:**

| Status | Respuesta | Causa |
|--------|-----------|-------|
| 400 | `{ "error": "Faltan campos: to, type" }` | Campos obligatorios no enviados |
| 503 | `{ "error": "Instancia \"ventas\" no conectada" }` | Instancia no está conectada |
| 500 | `{ "error": "mensaje de error" }` | Error interno al enviar |

---

### 5. Listar grupos

```
GET /instances/:name/groups
```

Devuelve todos los grupos en los que participa la instancia.

**Respuesta:**

```json
[
  {
    "id": "120363012345678901@g.us",
    "name": "Equipo de ventas",
    "participants": 15
  },
  {
    "id": "120363098765432101@g.us",
    "name": "Soporte técnico",
    "participants": 8
  }
]
```

**Ejemplo:**

```bash
curl http://localhost:3000/instances/ventas/groups \
  -H "x-api-key: tu-api-key"
```

---

### 6. Desconectar instancia

```
DELETE /instances/:name
```

Cierra la sesión de WhatsApp y elimina los datos de la instancia.

**Respuesta:**

```json
{ "ok": true }
```

**Error (instancia no encontrada):**

```json
{ "error": "Instancia no encontrada" }
```

**HTTP Status:** `404`

---

### 7. Registros de mensajes

```
GET /logs
```

Devuelve el historial de mensajes enviados.

**Parámetros de query:**

| Parámetro | Tipo | Obligatorio | Descripción |
|-----------|------|-------------|-------------|
| `instance` | string | No | Filtrar por nombre de instancia |
| `limit` | number | No | Cantidad de registros (default: `20`) |

**Respuesta:**

```json
[
  {
    "id": 42,
    "instance": "ventas",
    "to": "5491155551234",
    "type": "text",
    "status": "ok",
    "error": null,
    "created_at": "2025-01-15T14:22:00.000Z"
  }
]
```

**Ejemplo:**

```bash
curl "http://localhost:3000/logs?instance=ventas&limit=50" \
  -H "x-api-key: tu-api-key"
```

---

## Ejemplos de integración

### Node.js

```javascript
const API_URL = "http://localhost:3000";
const API_KEY = "tu-api-key";

async function enviarWhatsApp(instancia, telefono, mensaje) {
  const response = await fetch(`${API_URL}/instances/${instancia}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      to: telefono,
      type: "text",
      text: mensaje,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return response.json();
}

// Uso
await enviarWhatsApp("ventas", "5491155551234", "Tu pedido fue enviado.");
```

### Python

```python
import requests

API_URL = "http://localhost:3000"
API_KEY = "tu-api-key"

def enviar_whatsapp(instancia: str, telefono: str, mensaje: str):
    response = requests.post(
        f"{API_URL}/instances/{instancia}/send",
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        json={
            "to": telefono,
            "type": "text",
            "text": mensaje,
        },
    )
    response.raise_for_status()
    return response.json()

# Uso
enviar_whatsapp("ventas", "5491155551234", "Tu pedido fue enviado.")
```

### PHP

```php
<?php

$apiUrl = "http://localhost:3000";
$apiKey = "tu-api-key";

function enviarWhatsApp(string $instancia, string $telefono, string $mensaje): array
{
    $ch = curl_init("$GLOBALS[apiUrl]/instances/$instancia/send");
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            "Content-Type: application/json",
            "x-api-key: $GLOBALS[apiKey]",
        ],
        CURLOPT_POSTFIELDS => json_encode([
            "to" => $telefono,
            "type" => "text",
            "text" => $mensaje,
        ]),
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200) {
        throw new Exception("Error al enviar: $response");
    }

    return json_decode($response, true);
}

// Uso
enviarWhatsApp("ventas", "5491155551234", "Tu pedido fue enviado.");
```

### Go

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

const (
	apiURL = "http://localhost:3000"
	apiKey = "tu-api-key"
)

func enviarWhatsApp(instancia, telefono, mensaje string) error {
	body, _ := json.Marshal(map[string]string{
		"to":   telefono,
		"type": "text",
		"text": mensaje,
	})

	req, _ := http.NewRequest("POST",
		fmt.Sprintf("%s/instances/%s/send", apiURL, instancia),
		bytes.NewBuffer(body),
	)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("error: status %d", resp.StatusCode)
	}
	return nil
}

func main() {
	err := enviarWhatsApp("ventas", "5491155551234", "Tu pedido fue enviado.")
	if err != nil {
		fmt.Println("Error:", err)
	}
}
```

### Webhook / n8n / Make (Integromat)

Para integrar con plataformas low-code, configura un nodo HTTP con:

- **URL:** `http://tu-servidor:3000/instances/ventas/send`
- **Método:** `POST`
- **Headers:**
  - `Content-Type`: `application/json`
  - `x-api-key`: `tu-api-key`
- **Body:**

```json
{
  "to": "{{telefono}}",
  "type": "text",
  "text": "{{mensaje}}"
}
```

---

## Enviar a grupos

Para enviar mensajes a un grupo, primero obtén el ID del grupo:

```bash
curl http://localhost:3000/instances/ventas/groups \
  -H "x-api-key: tu-api-key"
```

Luego usa el `id` del grupo como valor de `to`:

```bash
curl -X POST http://localhost:3000/instances/ventas/send \
  -H "x-api-key: tu-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "120363012345678901@g.us",
    "type": "text",
    "text": "Recordatorio: reunión a las 15:00"
  }'
```

---

## Health check

Endpoint sin autenticación, útil para load balancers, Docker health checks y monitoreo:

```bash
curl http://localhost:3000/health
```

Respuesta:
```json
{
  "ok": true,
  "uptime": 3600.123
}
```

---

## Seguridad

WAME incluye varias capas de protección:

| Mecanismo | Descripción |
|-----------|-------------|
| **Helmet** | Headers HTTP de seguridad (X-Frame-Options, CSP, etc.) |
| **Rate limiting** | 100 req/min global, 30 envíos/min por IP (configurable) |
| **CORS** | Control de origen cruzado (configurable via `CORS_ORIGIN`) |
| **Body limit** | Máximo 5 MB por request |
| **Timing-safe auth** | Comparación en tiempo constante del API key (previene timing attacks) |
| **Path traversal** | Nombres de instancia validados: solo `[a-zA-Z0-9_-]` |
| **URL validation** | Solo URLs HTTP/HTTPS en media (previene SSRF con `file://`, etc.) |
| **Input validation** | Formato de teléfono E.164, tipos de mensaje válidos |

---

## Monitor de actualizaciones

Al iniciar, WAME verifica automáticamente si hay nuevas versiones de las dependencias críticas (Baileys, Express, Supabase) consultando el registro de npm. Los avisos aparecen en la consola:

```
[updater] Verificando actualizaciones de dependencias...
[updater] ⚠ @whiskeysockets/baileys: instalada 6.7.16 → disponible 6.8.0
[updater] Ejecuta "npm update" o revisa los changelogs antes de actualizar.
```

---

## Códigos de error

| HTTP Status | Significado | Acción recomendada |
|-------------|-------------|-------------------|
| `400` | Campos obligatorios faltantes o formato inválido | Verificar `to`, `type` y formato del número |
| `401` | API key inválida o no enviada | Verificar el header `x-api-key` |
| `404` | Instancia no encontrada | Verificar el nombre de la instancia |
| `429` | Rate limit alcanzado | Esperar y reintentar con backoff |
| `500` | Error interno del servidor | Revisar logs del servidor |
| `503` | Instancia no conectada | Reconectar la instancia con `/connect` |

---

## Buenas prácticas

1. **Verifica el estado** antes de enviar mensajes para evitar errores 503.
2. **Usa reintentos** con backoff exponencial para manejar errores transitorios.
3. **No envíes spam**: WhatsApp puede banear números que envían mensajes masivos no solicitados.
4. **Guarda la API key** de forma segura; nunca la expongas en código del lado del cliente.
5. **Monitorea los logs** para detectar errores de envío y actuar rápidamente.
6. **Usa una instancia por caso de uso** (ej: `ventas`, `soporte`, `notificaciones`) para organizar mejor los envíos.
