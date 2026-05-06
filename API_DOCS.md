# WAME — API Reference

Complete guide for integrating any service with WAME.

---

## Authentication

WAME supports two authentication methods:

### 1. Admin API key (global)

Set `API_KEY` in `.env`. This key has full access to all instances.

```
x-api-key: your-admin-key
```

### 2. User accounts (multi-tenant)

Register an account to get a unique API key. Each account only has access to its own instances.

```bash
# Register
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "mypassword"}'

# Response: { "ok": true, "email": "user@example.com", "apiKey": "wame_a1b2c3..." }
```

Then use the returned key:

```
x-api-key: wame_a1b2c3...
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

1. Deploy WAME.
2. Register an account (`POST /auth/register`) or use the admin `API_KEY`.
3. Connect an instance — `POST /instances/:name/connect`.
4. Scan the returned QR with WhatsApp.
5. Send messages — `POST /instances/:name/send`.
6. Register a webhook to receive incoming events — `POST /instances/:name/webhooks`.

---

## Endpoints

### Register account

```
POST /auth/register
```

No authentication required. Creates a new account and returns a unique API key.

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Valid email address |
| `password` | string | Yes | Minimum 6 characters |

**Response `201`:**

```json
{
  "ok": true,
  "email": "user@example.com",
  "apiKey": "wame_a1b2c3d4e5f6..."
}
```

**Errors:**

| Status | Cause |
|--------|-------|
| 400 | Missing/invalid email or password too short |
| 409 | Email already registered |
| 429 | Rate limit exceeded |

---

### Login

```
POST /auth/login
```

No authentication required. Returns the API key for an existing account.

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Registered email |
| `password` | string | Yes | Account password |

**Response:**

```json
{
  "ok": true,
  "email": "user@example.com",
  "apiKey": "wame_a1b2c3d4e5f6..."
}
```

**Errors:**

| Status | Cause |
|--------|-------|
| 401 | Invalid credentials |
| 429 | Rate limit exceeded |

---

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

Returns instances owned by the authenticated account. Admin key sees all instances.

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
| `jpegThumbnail` | string | No | Base64-encoded JPEG (≤ 256KB) used as the inline chat preview for `image`. **Override only** — if you provide all three of `jpegThumbnail`, `width`, and `height`, the server uses your values verbatim. If any is missing, the server auto-generates them (see below). |
| `width` | integer | No | Image width in pixels for `image` (1–32768). See `jpegThumbnail` for override semantics. |
| `height` | integer | No | Image height in pixels for `image` (1–32768). See `jpegThumbnail` for override semantics. |

**Auto-generated previews:** if you don't provide `jpegThumbnail` / `width` / `height` (or provide only some of them), the server downloads the image, normalizes it to JPEG with `sharp`, and lets Baileys auto-derive the dimensions and inline thumbnail. This is the default and produces correct previews for any aspect ratio (including vertical 9:16) without any work on the caller's side. Download cap: 16MB, timeout 15s.
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

Vertical / non-square images are handled automatically — the server downloads the URL, normalizes to JPEG, and Baileys generates the correct inline thumbnail. No extra fields needed.

**Custom thumbnail override** (only when you want to control the preview manually — e.g. branded thumbnail, padding, custom crop):

```bash
curl -X POST http://localhost:3000/instances/sales/send \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "5215551234567",
    "type": "image",
    "url": "https://example.com/story-1080x1920.jpg",
    "caption": "Today'\''s devotional",
    "width": 1080,
    "height": 1920,
    "jpegThumbnail": "/9j/4AAQSkZJRgABAQAAAQABAAD/..."
  }'
```

All three fields (`jpegThumbnail`, `width`, `height`) must be present together to take effect. The server validates the thumbnail's magic bytes (`FF D8 FF`) and size (≤ 256KB).

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

### Check number

```
POST /instances/:name/check-number
```

Verify if a phone number is registered on WhatsApp before sending a message.

**Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | string | Yes | Phone number to check |

**Response:**

```json
{
  "exists": true,
  "jid": "5491155551234@s.whatsapp.net"
}
```

If the number is not on WhatsApp:

```json
{
  "exists": false,
  "jid": null
}
```

---

### Restart instance

```
POST /instances/:name/restart
```

Disconnects and reconnects the instance **without deleting the session**. Useful when the connection has issues or after updates.

**Response:**

```json
{
  "status": "connected"
}
```

If the instance doesn't exist: **404** `{ "error": "Instancia no encontrada" }`

---

### Profile picture

```
GET /instances/:name/profile-picture?jid=5491155551234
```

Get the profile picture URL for a contact or group.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `jid` | string | Yes | Phone number or JID |

**Response:**

```json
{
  "url": "https://pps.whatsapp.net/v/t61.24694-24/..."
}
```

If no profile picture: `{ "url": null }`

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

Returns sent message history (stored in embedded SQLite). Filtered by account ownership — each user only sees logs from their own instances. Admin key sees all logs.

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
| `401` | Unauthorized | Check the `x-api-key` header or credentials |
| `403` | Forbidden — instance belongs to another account | Use your own instances |
| `404` | Instance or webhook not found | Verify the name/ID |
| `409` | Conflict — email already registered | Use `/auth/login` instead |
| `429` | Rate limit exceeded | Back off and retry |
| `500` | Internal server error | Check server logs |
| `503` | Instance not connected | Reconnect with `/connect` |

---

## Security

| Layer | Details |
|-------|---------|
| Multi-tenant isolation | Each account only accesses its own instances, webhooks, and logs |
| Password hashing | scrypt via Node.js native crypto (no external dependencies) |
| Timing-safe auth | Constant-time API key comparison (prevents timing attacks) |
| Helmet | HTTP security headers |
| Rate limiting | 100 req/min global · 30 send/min per IP · 10 auth/min per IP |
| Body limit | 5 MB max per request |
| SSRF protection | Media URLs must be HTTP/HTTPS — `file://` and others are rejected |
| Path traversal | Instance names validated to `[a-zA-Z0-9_-]` only |
| Input validation | Phone format, message type whitelist, webhook URL and event validation |
