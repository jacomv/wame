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

To broadcast to a channel instead of messaging a contact, add two steps:

7. Register the channel once — `POST /instances/:name/newsletters` with its JID
   or invite code. The response tells you whether the account may publish.
8. Publish — `POST /instances/:name/newsletters/:jid/send`.

See [Channels (newsletters)](#channels-newsletters).

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

The running version is deliberately **not** exposed here — this endpoint is
public, and advertising the version tells anyone which known vulnerabilities to
try. Use `GET /version` instead.

---

### Version and updates

```
GET /version
```

Requires authentication. Returns the running version and whether a newer release
is published on GitHub. The GitHub lookup is cached for 6 hours and fails
silently, so the endpoint keeps working with no internet — `latest` simply comes
back `null`.

```json
{
  "current": "1.2.0",
  "latest": "1.2.0",
  "updateAvailable": false,
  "releaseUrl": "https://github.com/jacomv/wame/releases/tag/v1.2.0",
  "enabled": true
}
```

`enabled` is `false` when the server runs with `UPDATE_CHECK=false`; in that case
no outbound request is made and `latest` is always `null`.

To update, pull the new image and recreate the container:

```bash
docker compose pull && docker compose up -d
```

There is no in-app update endpoint by design: a container updating itself needs
the Docker socket mounted, which grants host-level access to anyone who
compromises the panel.

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

## Channels (newsletters)

WhatsApp channels are one-way broadcast threads. Their JID uses the
`@newsletter` server (`120363099999999999@newsletter`) instead of
`@s.whatsapp.net` or `@g.us`.

**Publishing requires the account to be `ADMIN` or `OWNER` of the channel.** A
`SUBSCRIBER` cannot post — WAME checks the role and returns `403` rather than
letting WhatsApp reject it with an opaque error.

### Why channels must be registered

There is no way to enumerate the channels an account belongs to. Baileys has
`groupFetchAllParticipating()` for groups and `communityFetchAllParticipating()`
for communities, but no channel equivalent — not in 6.7.x and not in the
7.0.0-rc branch. WhatsApp does not include channels in the history sync WAME
requests either.

So WAME keeps its own registry: you add a channel once by JID or invite code,
and from then on it can be listed and refreshed.

---

### Register a channel

```
POST /instances/:name/newsletters
```

Give it either a `jid` or an `invite`. The invite accepts the full link or the
bare code — whichever you copied.

```bash
curl -X POST http://localhost:3000/instances/main/newsletters \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"invite": "https://whatsapp.com/channel/0029VaAbCdEfGhIjKl"}'
```

```json
{
  "jid": "120363099999999999@newsletter",
  "name": "Announcements",
  "description": "Product updates",
  "invite": "0029VaAbCdEfGhIjKl",
  "subscribers": 1284,
  "verification": "UNVERIFIED",
  "role": "OWNER",
  "muted": false,
  "createdAt": 1700000000,
  "canPublish": true
}
```

Status `201`. Returns `404` if the channel does not exist or is not visible to
this account, `502` if WhatsApp rejected the lookup.

---

### List registered channels

```
GET /instances/:name/newsletters
```

Returns the registered channels, refreshing each one against WhatsApp. A
channel that can no longer be read (deleted, or the account lost access) comes
back with its stored values and `"stale": true` instead of failing the whole
request.

```json
[
  {
    "jid": "120363099999999999@newsletter",
    "name": "Announcements",
    "subscribers": 1284,
    "role": "OWNER",
    "canPublish": true,
    "stale": false,
    "trackedAt": "2026-09-07T12:00:00.000Z"
  }
]
```

---

### Channel metadata

```
GET /instances/:name/newsletters/:jid
```

Works whether or not the channel is registered — use it to inspect a channel
and see what role the account has before adding it. The response adds
`"tracked": true|false`.

---

### Publish to a channel

```
POST /instances/:name/newsletters/:jid/send
```

Same body as [Send message](#send-message) minus the `to` field (the JID is in
the path). All four types work — `text`, `image`, `audio`, `document`.

```bash
curl -X POST "http://localhost:3000/instances/main/newsletters/120363099999999999@newsletter/send" \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "text", "text": "New release is out"}'
```

```json
{ "ok": true }
```

Returns `403` when the account's role is not `ADMIN` or `OWNER`.

This route shares the `SEND_RATE_LIMIT` budget with `POST /instances/:name/send`
on purpose — a separate quota would double the effective send limit.

`POST /instances/:name/send` also accepts a channel JID in `to`, which is
handy if your integration already builds that call. The dedicated route is
preferable because it verifies the publishing role first.

---

### Unregister a channel

```
DELETE /instances/:name/newsletters/:jid
```

Removes it from WAME's registry only — the account keeps following the channel
on WhatsApp.

```json
{ "ok": true }
```

---

### Receiving channel messages

Off by default. An account typically follows dozens of third-party channels, and
every post in every one of them would fire the `messages` webhook.

Set `NEWSLETTER_INBOUND=true` to receive them. Channel messages then arrive
through the ordinary `messages` webhook with `"isNewsletter": true`.

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
    "isGroup": false,
    "isNewsletter": false
  }
}
```

`isNewsletter` is always `false` unless `NEWSLETTER_INBOUND=true` — channel
messages are dropped before this point otherwise. See
[Receiving channel messages](#receiving-channel-messages).

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

## Publishing to a channel — worked example

Registering is a one-time setup step, not something to repeat per broadcast.
Do it once (by hand or on first run), store the returned JID, and publish
against that JID from then on.

### Node.js

```javascript
const WAME_URL = "http://localhost:3000";
const API_KEY  = "your-api-key";

const api = async (path, options = {}) => {
  const res = await fetch(`${WAME_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${body.error}`);
  return body;
};

/**
 * One-time setup. `invite` accepts the full whatsapp.com/channel/... link or
 * the bare code. Returns the channel JID — persist it.
 */
async function registerChannel(instance, invite) {
  const channel = await api(`/instances/${instance}/newsletters`, {
    method: "POST",
    body: JSON.stringify({ invite }),
  });

  // Check this before wiring up a broadcast job: a SUBSCRIBER cannot publish,
  // and finding out at broadcast time means a failed send.
  if (!channel.canPublish) {
    throw new Error(`Cannot publish to "${channel.name}" — role is ${channel.role}, needs ADMIN or OWNER`);
  }
  return channel.jid;
}

/** Publish. Same payloads as /send — text, image, audio, document. */
function publish(instance, jid, content) {
  return api(`/instances/${instance}/newsletters/${jid}/send`, {
    method: "POST",
    body: JSON.stringify(content),
  });
}

const jid = await registerChannel("main", "https://whatsapp.com/channel/0029VaAbCdEfGhIjKl");

await publish("main", jid, { type: "text", text: "New release is out" });

await publish("main", jid, {
  type: "image",
  url: "https://example.com/banner.jpg",
  caption: "v1.3.0 is live",
});
```

### Python

```python
import requests

WAME_URL = "http://localhost:3000"
API_KEY  = "your-api-key"

def api(path: str, method: str = "GET", payload: dict | None = None):
    r = requests.request(
        method, f"{WAME_URL}{path}",
        headers={"x-api-key": API_KEY}, json=payload,
    )
    if not r.ok:
        raise RuntimeError(f"{r.status_code}: {r.json().get('error')}")
    return r.json()

def register_channel(instance: str, invite: str) -> str:
    """One-time setup. Returns the channel JID — persist it."""
    channel = api(f"/instances/{instance}/newsletters", "POST", {"invite": invite})
    if not channel["canPublish"]:
        raise RuntimeError(
            f"Cannot publish to {channel['name']!r} — role is {channel['role']}, needs ADMIN or OWNER"
        )
    return channel["jid"]

def publish(instance: str, jid: str, content: dict):
    return api(f"/instances/{instance}/newsletters/{jid}/send", "POST", content)

jid = register_channel("main", "https://whatsapp.com/channel/0029VaAbCdEfGhIjKl")
publish("main", jid, {"type": "text", "text": "New release is out"})
```

### Listing what you can publish to

```bash
curl "http://localhost:3000/instances/main/newsletters" \
  -H "x-api-key: your-api-key"
```

Filter on `canPublish` — roles change, so a channel registered as `OWNER` can
come back as `SUBSCRIBER` later.

```bash
# Only the channels this account can currently post to
curl -s "http://localhost:3000/instances/main/newsletters" \
  -H "x-api-key: your-api-key" | jq '[.[] | select(.canPublish)]'
```

A channel with `"stale": true` could not be refreshed from WhatsApp — its
values are the last known ones. Treat it as unpublishable until it recovers.

### n8n / Make / Zapier

Register the channel once with curl, then configure an HTTP node with the JID
hardcoded in the URL:

- **Method:** `POST`
- **URL:** `http://your-server:3000/instances/main/newsletters/120363099999999999@newsletter/send`
- **Headers:** `x-api-key: your-api-key`, `Content-Type: application/json`
- **Body:**

```json
{ "type": "text", "text": "{{message}}" }
```

Note there is no `to` field — the destination is the JID in the path.

---

## Error reference

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| `400` | Bad request — missing fields, invalid phone, unsupported type, malformed channel JID or invite code | Check `to`, `type`, and phone/JID format |
| `401` | Unauthorized | Check the `x-api-key` header or credentials |
| `403` | Forbidden — instance belongs to another account, or the account is not `ADMIN`/`OWNER` of the channel | Use your own instances; check `canPublish` before publishing |
| `404` | Instance, webhook, or channel not found | Verify the name/ID; a channel must exist and be visible to this account |
| `409` | Conflict — email already registered | Use `/auth/login` instead |
| `429` | Rate limit exceeded | Back off and retry |
| `500` | Internal server error | Check server logs |
| `502` | WhatsApp rejected the channel lookup | Transient upstream failure — retry; if it persists, confirm the channel still exists |
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
