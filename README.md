# WAME — WhatsApp REST API

A minimal WhatsApp REST API. It does two things:

1. **Send messages** — text, images, audio, documents
2. **Receive events** — via webhooks on incoming messages and group changes

That's it. No database setup. No external services. One `API_KEY` and you're running.

> **Looking for an Evolution API alternative?** WAME has ~10% of its surface area. If you only need to send messages and receive webhooks, WAME is all you need.

---

## Quick start

```bash
git clone https://github.com/Jacobisaldana/wame.git
cd wame
cp .env.example .env   # then edit API_KEY
docker compose up -d
```

Open `http://your-server:3000` — scan the QR, start sending.

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

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/status` | Status of all instances |
| `POST` | `/instances/:name/connect` | Connect / reconnect instance |
| `GET` | `/instances/:name/status` | Instance status + QR code |
| `POST` | `/instances/:name/send` | Send a message |
| `GET` | `/instances/:name/groups` | List groups |
| `GET` | `/instances/:name/groups/:id/participants` | List group participants |
| `POST` | `/instances/:name/webhooks` | Register a webhook |
| `GET` | `/instances/:name/webhooks` | List webhooks |
| `DELETE` | `/instances/:name/webhooks/:id` | Remove a webhook |
| `DELETE` | `/instances/:name` | Disconnect and delete instance |
| `GET` | `/logs` | Message history |

Full examples in [API_DOCS.md](./API_DOCS.md).

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | **Required.** Auth key sent as `x-api-key` header |
| `PORT` | `3000` | Server port |
| `SESSION_DIR` | `./data/sessions` | Baileys session storage |
| `RATE_LIMIT` | `100` | Max requests/min (global) |
| `SEND_RATE_LIMIT` | `30` | Max send requests/min per IP |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

---

## Security

- Timing-safe API key comparison (prevents timing attacks)
- Helmet security headers
- Rate limiting on all routes
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
