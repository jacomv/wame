# WAME — WhatsApp REST API

A minimal WhatsApp REST API. It does three things:

1. **Send messages** — text, images, video (including GIF and video notes), audio, documents
2. **Receive events** — via webhooks on incoming messages and group changes
3. **Multi-tenant accounts** — each user has an account with its own API key and manages only their instances

That's it. No external services. Embedded SQLite. Deploy and go.

> **Looking for an Evolution API alternative?** WAME has ~10% of its surface area. If you only need to send messages and receive webhooks, WAME is all you need.

---

## Quick start

```bash
git clone https://github.com/Jacobisaldana/wame.git
cd wame
cp .env.example .env   # then edit API_KEY
docker compose up -d
```

Open `http://your-server:3000` — create the first account (sign-up is open only until it exists), scan the QR, start sending.

---

## Accounts

WAME supports two authentication modes:

- **Admin key** — set `API_KEY` in `.env`. Has access to all instances over the API (`x-api-key`). It does not sign into the web panel.
- **User accounts** — email and password for the web panel, plus a per-account API key for integrations. Each user only sees and uses their own instances.

An account owns the instances it creates. An instance with no owner — created with the admin key, or older than the account system — belongs to the admin only; accounts cannot see, use or claim it.

### Registration

By default the first account can sign up from the panel, and sign-up closes as soon as it exists. After that only the admin key can create accounts (send it as `x-api-key` on `POST /auth/register`). Set `ALLOW_REGISTRATION=true` to keep public sign-up open, or `false` to close it even for the first account. Passwords need at least 12 characters.

```bash
# Create an account with the admin key (sign-up closed)
curl -X POST http://localhost:3000/auth/register \
  -H "x-api-key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "a-long-password-123"}'
# → { "ok": true, "email": "user@example.com" }
```

### Getting an account API key

Registration and login do not return the API key. The panel signs in with a 12-hour session cookie, and the account key is issued by **Rotate API key** in the sidebar: confirm the password, copy the key (it is shown once). Rotating again invalidates the previous key immediately.

Without the panel, the same flow works with curl. The rotate call needs the session cookie and an `Origin` header that matches the server:

```bash
BASE=https://wame.example.com
curl -c cookie.txt -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "a-long-password-123"}' $BASE/auth/login
curl -b cookie.txt -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d '{"password": "a-long-password-123"}' $BASE/auth/api-key/rotate
# → { "ok": true, "apiKey": "wame_a1b2c3d4e5f6..." }
```

Use that `apiKey` as the `x-api-key` header. Keys are stored only as SHA-256 hashes, so a lost key cannot be recovered — rotate it.

---

## Docker Compose

```yaml
services:
  wame:
    image: Jacobisaldana/wame
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - wame_data:/data
    environment:
      API_KEY: your-secret-key

volumes:
  wame_data:
```

Sessions and webhooks are persisted in the `wame_data` volume. No external database required.

---

## Without Docker

Requires Node.js 20+.

```bash
git clone https://github.com/Jacobisaldana/wame.git
cd wame
npm install
echo "API_KEY=your-secret-key" > .env
npm start
```

---

## Send a message

```bash
curl -X POST http://localhost:3000/instances/my-number/send \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"to": "5215551234567", "type": "text", "text": "Hello from WAME"}'
```

Supports `text`, `image`, `video` (with GIF and round video-note modes), `audio` (with voice note mode), and `document`.

---

## Publish to a channel

Channels (newsletters) are broadcast threads. Register one once — by invite link
or JID — then publish to it. The account must be `ADMIN` or `OWNER` of the
channel.

```bash
# 1. Register. Returns the channel JID and whether you can publish.
curl -X POST http://localhost:3000/instances/my-number/newsletters \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"invite": "https://whatsapp.com/channel/0029VaAbCdEfGhIjKl"}'

# 2. Publish. Same message types as /send.
curl -X POST "http://localhost:3000/instances/my-number/newsletters/120363099999999999@newsletter/send" \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"type": "text", "text": "New release is out"}'
```

Registration is a one-time step because there is no way to enumerate the
channels an account belongs to — Baileys has no channel equivalent of
`groupFetchAllParticipating()`, so WAME keeps its own registry. Full detail and
client examples in [API_DOCS.md](./API_DOCS.md#channels-newsletters).

---

## Receive messages via webhook

Register a URL to receive incoming messages:

```bash
curl -X POST http://localhost:3000/instances/my-number/webhooks \
  -H "x-api-key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server.com/webhook", "events": ["messages"]}'
```

WAME will POST to your URL with this payload:

```json
{
  "event": "messages",
  "instance": "my-number",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "data": { ... }
}
```

**Available events:** `messages`, `group.join`, `group.leave`

---

## Multi-instance

Each instance is an independent WhatsApp connection. Create as many as you need:

```bash
# Connect two numbers
curl -X POST http://localhost:3000/instances/sales/connect -H "x-api-key: your-key"
curl -X POST http://localhost:3000/instances/support/connect -H "x-api-key: your-key"
```

Sessions survive server restarts automatically.

---

## API reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/health` | No | Health check |
| `GET` | `/auth/config` | No | Public settings (`registration` open or closed) |
| `POST` | `/auth/register` | No* | Create account and panel session (*admin key required once sign-up is closed) |
| `POST` | `/auth/login` | No | Login with email/password, sets the panel session cookie |
| `GET` | `/auth/session` | Cookie | Current panel session |
| `POST` | `/auth/logout` | Cookie | Revoke the panel session |
| `POST` | `/auth/api-key/rotate` | Cookie + password | Issue a new account API key (shown once) |
| `GET` | `/status` | Yes | Status of all instances (filtered by account) |
| `POST` | `/instances/:name/connect` | Yes | Connect / reconnect instance |
| `GET` | `/instances/:name/status` | Yes | Instance status + QR code |
| `POST` | `/instances/:name/send` | Yes | Send a message |
| `POST` | `/instances/:name/check-number` | Yes | Verify WhatsApp number |
| `POST` | `/instances/:name/restart` | Yes | Restart without deleting session |
| `GET` | `/instances/:name/profile-picture` | Yes | Get profile picture URL |
| `GET` | `/instances/:name/groups` | Yes | List groups |
| `GET` | `/instances/:name/groups/:id/participants` | Yes | List group participants |
| `POST` | `/instances/:name/newsletters` | Yes | Register a channel by JID or invite |
| `GET` | `/instances/:name/newsletters` | Yes | List registered channels |
| `GET` | `/instances/:name/newsletters/:jid` | Yes | Channel metadata and role |
| `POST` | `/instances/:name/newsletters/:jid/send` | Yes | Publish to a channel |
| `DELETE` | `/instances/:name/newsletters/:jid` | Yes | Unregister a channel |
| `POST` | `/instances/:name/webhooks` | Yes | Register a webhook |
| `GET` | `/instances/:name/webhooks` | Yes | List webhooks |
| `PUT` | `/instances/:name/webhooks/:id` | Yes | Update a webhook |
| `DELETE` | `/instances/:name/webhooks/:id` | Yes | Remove a webhook |
| `POST` | `/instances/:name/webhooks/test` | Yes | Test webhook delivery |
| `DELETE` | `/instances/:name` | Yes | Disconnect and delete instance |
| `GET` | `/logs` | Yes | Message history (filtered by account) |

Full examples in [API_DOCS.md](./API_DOCS.md).

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | Admin API key (full access to all instances). Optional if using account system only. |
| `PORT` | `3000` | Server port |
| `SESSION_DIR` | `./data/sessions` | Legacy file-based sessions (migrated to SQLite on first start) |
| `DATA_DIR` | `./data` | SQLite database location |
| `RATE_LIMIT` | `100` | Max requests/min (global) |
| `SEND_RATE_LIMIT` | `30` | Max send requests/min per IP |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `ALLOW_REGISTRATION` | — | Unset: the first account signs up, then sign-up closes. `true`: always open. `false`: closed, even for the first account (create it with the admin key). |
| `TRUST_PROXY` | `1` | Proxies trusted for `X-Forwarded-*` (Express `trust proxy`). Keep `1` behind Traefik/Nginx; set `false` if the port is exposed directly, otherwise clients can spoof their IP. |
| `MSG_CACHE_TTL_HOURS` | `24` | How long a sent message is kept so it can be resent if the recipient fails to decrypt it. Lower it to reduce how long message content stays stored. |
| `UPDATE_CHECK` | `true` | Check GitHub for new WAME releases and npm for dependency updates. Set to `false` to make the install do no outbound calls. |
| `NEWSLETTER_INBOUND` | `false` | Deliver channel (newsletter) messages to the `messages` webhook. Off by default: an account usually follows dozens of third-party channels and every post would fire the webhook. Publishing to channels works either way. |
| `BAILEYS_LOG_LEVEL` | `silent` | Baileys log level (`silent`, `error`, `warn`, `info`, `debug`, `trace`). Raise it to `debug` for deeper diagnosis of messages stuck on "Waiting for this message". Noisy in production — the `[retry]` lines below are logged regardless. |

### Diagnosing "Waiting for this message"

Every retry receipt is logged unconditionally, one line each:

```
[retry] devocional msg=3EB0A1 attempt=1/5 to=573004211788@s.whatsapp.net participant=- addressing=PN cache=HIT
```

Read it as follows:

| Symptom | Meaning |
|---|---|
| No `[retry]` line at all for the message | The recipient never asked for a resend. Nothing on the sending side can fix it. |
| `cache=MISS` | The retry arrived but the original was gone — the resend is impossible. |
| `attempt=` climbing to `2/5`, `3/5`… | Each resend also failed to decrypt. Baileys resends with a session rebuilt from fresh prekeys, so repeated failures point at *addressing*, not at the crypto. |
| `addressing=LID` | The target is a LID-addressed contact. Baileys 6.7.x carries no LID↔PN mapping (`lib/Signal/lid-mapping.js` exists only in 7.0.0-rc), which makes this a likely cause of the failure. |

```bash
docker compose logs --since 1h | grep '\[retry\]'
```

---

## Security

- Multi-tenant isolation (each account only accesses its own instances)
- Passwords hashed with scrypt (Node.js native crypto)
- API keys stored as SHA-256 hashes, rotated with password confirmation
- Web panel uses an HttpOnly, SameSite=Strict session cookie (12 h, revocable); cookie-authenticated writes require a same-origin `Origin` header
- Timing-safe admin key comparison (prevents timing attacks)
- Helmet security headers
- Rate limiting on all routes (stricter on auth endpoints, plus a per-account lockout after 10 failed logins in 15 minutes)
- JSON error responses without stack traces
- Input validation and phone number normalization
- SSRF protection on media URLs (only `http://` and `https://` allowed)
- Instance name validation (alphanumeric + `-_`) prevents path traversal

---

## Stack

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web protocol
- [Express](https://expressjs.com/) — HTTP server
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — embedded message logging
- No external services required

---

## License

MIT
