# WAME — WhatsApp REST API

A minimal WhatsApp REST API. It does three things:

1. **Send messages** — text, images, audio, documents
2. **Receive events** — via webhooks on incoming messages and group changes
3. **Multi-tenant accounts** — each user registers, gets their own API key, and manages only their instances

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

Open `http://your-server:3000` — register an account or use the admin API key, scan the QR, start sending.

---

## Accounts

WAME supports two authentication modes:

- **Admin key** — set `API_KEY` in `.env`. Has access to all instances (backward compatible).
- **User accounts** — anyone can register via the UI or API and get their own API key. Each user only sees their own instances.

```bash
# Register a new account via API
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "mypassword"}'
```

Response:

```json
{
  "ok": true,
  "email": "user@example.com",
  "apiKey": "wame_a1b2c3d4e5f6..."
}
```

Use the returned `apiKey` as `x-api-key` header for all subsequent requests.

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

Supports `text`, `image`, `audio` (with voice note mode), and `document`.

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
| `POST` | `/auth/register` | No | Create account, returns API key |
| `POST` | `/auth/login` | No | Login with email/password, returns API key |
| `GET` | `/status` | Yes | Status of all instances (filtered by account) |
| `POST` | `/instances/:name/connect` | Yes | Connect / reconnect instance |
| `GET` | `/instances/:name/status` | Yes | Instance status + QR code |
| `POST` | `/instances/:name/send` | Yes | Send a message |
| `POST` | `/instances/:name/check-number` | Yes | Verify WhatsApp number |
| `POST` | `/instances/:name/restart` | Yes | Restart without deleting session |
| `GET` | `/instances/:name/profile-picture` | Yes | Get profile picture URL |
| `GET` | `/instances/:name/groups` | Yes | List groups |
| `GET` | `/instances/:name/groups/:id/participants` | Yes | List group participants |
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
| `SESSION_DIR` | `./data/sessions` | Baileys session storage |
| `DATA_DIR` | `./data` | SQLite database location |
| `RATE_LIMIT` | `100` | Max requests/min (global) |
| `SEND_RATE_LIMIT` | `30` | Max send requests/min per IP |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

---

## Security

- Multi-tenant isolation (each account only accesses its own instances)
- Passwords hashed with scrypt (Node.js native crypto)
- Timing-safe API key comparison (prevents timing attacks)
- Helmet security headers
- Rate limiting on all routes (stricter on auth endpoints)
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
