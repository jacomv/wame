# WAME — API Reference

Complete guide for integrating any service with WAME.

---

## Authentication

All requests (except `/health`) require the `x-api-key` header.

```
x-api-key: your-api-key
```

Invalid or missing key returns:

```json
{ "error": "Unauthorized" }
```

**HTTP 401**

---

## Integration flow

```
┌──────────────────┐     ┌──────────┐     ┌───────────┐
│  Your Service    │────▶│  WAME    │────▶│ WhatsApp  │
│  (CRM, bot, etc) │ API │          │     │           │
│                  │◀────│          │◀────│           │
└──────────────────┘     └──────────┘     └───────────┘
```

1. Deploy WAME and set `API_KEY`.
2. Connect an instance — `POST /instances/:name/connect`.
3. Scan the returned QR with WhatsApp.
4. Send messages — `POST /instances/:name/send`.
5. Register a webhook to receive incoming events — `POST /instances/:name/webhooks`.

---

## Endpoints

### Health check

```
GET /health
```

No authentication required. For load balancers and Docker health checks.

```json
{ "ok": true, "uptime": 3600.12 }
```

---

### All instances status

```
GET /status
```

**Response:**

```json
{
  "instances": [
    {
      "name": "sales",
      "status": "connected",
      "phone": "5215551234567",
      "connectedAt": "2025-01-15T10:30:00.000Z"
    },
    {
      "name": "support",
      "status": "qr",
      "phone": null,
      "connectedAt": null
    }
  ]
}
```

**Possible statuses:** `connecting` `qr` `connected` `logged_out` `disconnected`

---

### Connect instance

```
POST /instances/:name/connect
```

Creates or reconnects a WhatsApp instance. Instance names accept `[a-zA-Z0-9_-]`, max 64 chars.

**New instance — returns QR:**

```json
{
  "status": "qr",
  "qr": "data:image/png;base64,iVBORw0KGgo..."
}
```

**Already connected:**

```json
{ "status": "connected" }
```

```bash
curl -X POST http://localhost:3000/instances/sales/connect \
  -H "x-api-key: your-api-key"
```

---

### Instance status

```
GET /instances/:name/status
```

Returns the detailed status of a single instance, including the QR image if pending.

```json
{
  "name": "sales",
  "status": "connected",
  "qr": null,
  "phone": "5215551234567",
  "connectedAt": "2025-01-15T10:30:00.000Z"
}
```

---

### Send message

```
POST /instances/:name/send
```

**Body fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | Yes | Phone number (`5215551234567`) or group JID (`id@g.us`). `@s.whatsapp.net` is appended automatically for individual numbers. |
| `type` | string | Yes | `text` `image` `audio` `document` |
| `text` | string | For `text` | Message body |
| `url` | string | For media | Public URL of the file (HTTP/HTTPS only) |
| `caption` | string | No | Caption for `image` |
| `filename` | string | No | File name for `document` |
| `mimetype` | string | No | MIME type for `document` (default: `application/octet-stream`) or `audio` (default: `audio/mpeg`) |
| `ptt` | boolean | No | Send as voice note for `audio` (default: `false`) |

**`to` format:**

- Individual: country code + number, no `+` or spaces — e.g. `5215551234567` (Mexico), `573001234567` (Colombia)
- Group: use the JID returned by `/groups` — e.g. `120363012345678901@g.us`

#### Text

```bash
curl -X POST http://localhost:3000/instances/sales/send \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"to": "5215551234567", "type": "text", "text": "Your order #1234 has shipped."}'
```

#### Image

```bash
curl -X POST http://localhost:3000/instances/sales/send \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"to": "5215551234567", "type": "image", "url": "https://example.com/invoice.png", "caption": "January invoice"}'
```

#### Audio / voice note

```bash
curl -X POST http://localhost:3000/instances/sales/send \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"to": "5215551234567", "type": "audio", "url": "https://example.com/message.mp3", "ptt": true}'
```

#### Document

```bash
curl -X POST http://localhost:3000/instances/sales/send \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"to": "5215551234567", "type": "document", "url": "https://example.com/report.pdf", "filename": "report-jan-2025.pdf", "mimetype": "application/pdf"}'
```

**Success:** `{ "ok": true }`

**Errors:**

| Status | Cause |
|--------|-------|
| 400 | Missing `to` / `type`, invalid phone format, unsupported message type |
| 503 | Instance not connected |
| 500 | Internal send error |

---

### List groups

```
GET /instances/:name/groups
```

Returns all groups the instance is part of.

```json
[
  { "id": "120363012345678901@g.us", "name": "Sales team", "participants": 15 },
  { "id": "120363098765432101@g.us", "name": "Support",    "participants": 8  }
]
```

---

### Group participants

```
GET /instances/:name/groups/:groupId/participants
```

```json
[
  { "id": "5215551234567@s.whatsapp.net", "phone": "5215551234567", "admin": null },
  { "id": "5215559876543@s.whatsapp.net", "phone": "5215559876543", "admin": "admin" }
]
```

`admin` values: `null` (regular member) · `"admin"` · `"superadmin"`

---

### Disconnect instance

```
DELETE /instances/:name
```

Logs out from WhatsApp and deletes the session files.

```json
{ "ok": true }
```

---

## Webhooks

Webhooks let you receive real-time events from WhatsApp (incoming messages, group changes) sent as HTTP POST requests to your endpoint.

**Available events:**

| Event | Triggered when |
|-------|----------------|
| `messages` | A message is received (text, image, audio, document, video) |
| `group.join` | Someone joins a group |
| `group.leave` | Someone leaves a group |

**Payload shape:**

```json
{
  "event": "messages",
  "instance": "sales",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "data": {
    "from": "5215551234567@s.whatsapp.net",
    "pushName": "John",
    "type": "text",
    "text": "Hello!",
    "messageId": "ABCDEF123456",
    "isGroup": false
  }
}
```

Webhooks are fire-and-forget with a 5-second timeout per attempt.

---

### Register webhook

```
POST /instances/:name/webhooks
```

```json
{
  "url": "https://your-server.com/webhook",
  "events": ["messages"]
}
```

**Response `201`:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://your-server.com/webhook",
  "events": ["messages"],
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

---

### List webhooks

```
GET /instances/:name/webhooks
```

```json
{
  "webhooks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "url": "https://your-server.com/webhook",
      "events": ["messages"],
      "createdAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "availableEvents": ["messages", "group.join", "group.leave"]
}
```

---

### Update webhook

```
PUT /instances/:name/webhooks/:id
```

Replace the URL and/or events of an existing webhook.

```json
{
  "url": "https://your-server.com/webhook-v2",
  "events": ["messages", "group.join"]
}
```

Returns the updated webhook object.

---

### Delete webhook

```
DELETE /instances/:name/webhooks/:id
```

```json
{ "ok": true }
```

---

### Test webhooks

```
POST /instances/:name/webhooks/test
```

Fires a test `messages` payload to all registered webhooks for the instance and reports the result.

```json
{
  "results": [
    {
      "url": "https://your-server.com/webhook",
      "events": ["messages"],
      "httpStatus": 200,
      "ok": true,
      "response": "ok"
    }
  ]
}
```

---

## Message logs

```
GET /logs
```

Returns sent message history (stored in embedded SQLite).

**Query params:**

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `instance` | string | — | — | Filter by instance name |
| `limit` | number | `20` | `100` | Number of records |

**Response:**

```json
[
  {
    "id": 1,
    "instance": "sales",
    "to": "5215551234567@s.whatsapp.net",
    "type": "text",
    "status": "ok",
    "error": null,
    "created_at": "2025-01-15T14:22:00.000Z"
  }
]
```

```bash
curl "http://localhost:3000/logs?instance=sales&limit=50" \
  -H "x-api-key: your-api-key"
```

---

## Code examples

### Node.js

```javascript
const WAME_URL = "http://localhost:3000";
const API_KEY  = "your-api-key";

async function sendWhatsApp(instance, to, text) {
  const res = await fetch(`${WAME_URL}/instances/${instance}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ to, type: "text", text }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

await sendWhatsApp("sales", "5215551234567", "Your order has shipped.");
```

### Python

```python
import requests

WAME_URL = "http://localhost:3000"
API_KEY  = "your-api-key"

def send_whatsapp(instance: str, to: str, text: str):
    r = requests.post(
        f"{WAME_URL}/instances/{instance}/send",
        headers={"x-api-key": API_KEY},
        json={"to": to, "type": "text", "text": text},
    )
    r.raise_for_status()
    return r.json()

send_whatsapp("sales", "5215551234567", "Your order has shipped.")
```

### PHP

```php
function sendWhatsApp(string $instance, string $to, string $text): array {
    $ch = curl_init("http://localhost:3000/instances/$instance/send");
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ["Content-Type: application/json", "x-api-key: your-api-key"],
        CURLOPT_POSTFIELDS     => json_encode(["to" => $to, "type" => "text", "text" => $text]),
    ]);
    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status !== 200) throw new Exception("Error: $response");
    return json_decode($response, true);
}

sendWhatsApp("sales", "5215551234567", "Your order has shipped.");
```

### n8n / Make / Zapier

Configure an HTTP node:

- **Method:** `POST`
- **URL:** `http://your-server:3000/instances/sales/send`
- **Headers:** `x-api-key: your-api-key`, `Content-Type: application/json`
- **Body:**

```json
{ "to": "{{phone}}", "type": "text", "text": "{{message}}" }
```

---

## Error reference

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| `400` | Bad request — missing fields, invalid phone, unsupported type | Check `to`, `type`, and phone format |
| `401` | Unauthorized | Check the `x-api-key` header |
| `404` | Instance or webhook not found | Verify the name/ID |
| `429` | Rate limit exceeded | Back off and retry |
| `500` | Internal server error | Check server logs |
| `503` | Instance not connected | Reconnect with `/connect` |

---

## Security

| Layer | Details |
|-------|---------|
| Timing-safe auth | Constant-time API key comparison (prevents timing attacks) |
| Helmet | HTTP security headers |
| Rate limiting | 100 req/min global · 30 send req/min per IP (configurable) |
| Body limit | 5 MB max per request |
| SSRF protection | Media URLs must be HTTP/HTTPS — `file://` and others are rejected |
| Path traversal | Instance names validated to `[a-zA-Z0-9_-]` only |
| Input validation | Phone format, message type whitelist, webhook URL and event validation |
