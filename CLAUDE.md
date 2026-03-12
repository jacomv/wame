# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (with file watching)
npm run dev

# Production
npm start

# Docker
docker-compose up -d
docker-compose logs -f
```

There is no test suite or linter configured. The project uses ES modules (`"type": "module"` in package.json).

## Architecture

WAME is a WhatsApp REST API microservice supporting multiple simultaneous WhatsApp accounts (instances). Each instance maps to a separate Baileys WebSocket connection with its session persisted to disk.

**Request flow:**
1. `src/index.js` — Express server with Helmet, CORS, rate limiting, and `requireApiKey` middleware
2. `src/routes/instances.js` — Instance CRUD + message sending
3. `src/manager.js` — Creates/manages Baileys sockets, handles QR codes, reconnection, and webhook dispatch
4. `src/sender.js` — Validates and dispatches outgoing messages
5. `src/webhooks.js` — Stores webhook configs (JSON files in `./data/webhooks/`) and fires events on incoming messages/group changes
6. `src/logger.js` — Logs sent messages to a Supabase `whatsapp_logs` table

**Instance lifecycle:**
- `connectInstance(name)` opens a Baileys socket and saves credentials to `SESSION_DIR/<name>/`
- On server startup, `restoreExistingSessions()` reconnects all persisted sessions
- State machine: `connecting` → `qr` → `connected` | `logged_out`
- Disconnects trigger automatic reconnect after 5 seconds (unless deliberate logout)

**JID handling:** WhatsApp uses JIDs (e.g., `5215551234567@s.whatsapp.net` for individuals, `...@g.us` for groups). `src/utils/jid.js` normalizes plain phone numbers to JIDs. Instance names are validated to alphanumeric + `-_` (max 64 chars) to prevent path traversal.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `API_KEY` | Yes | Master auth key (sent as `x-api-key` header) |
| `PORT` | No (default 3000) | Server port |
| `SESSION_DIR` | No (default `./data/sessions`) | Baileys session storage |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase admin key |
| `RATE_LIMIT` | No (default 100) | Global req/min |
| `SEND_RATE_LIMIT` | No (default 30) | Send req/min |
| `CORS_ORIGIN` | No (default `*`) | Allowed CORS origin |

## Key Files

- `src/manager.js` — Core of the service; all WhatsApp socket logic lives here
- `src/sender.js` — Message type whitelist (`text`, `image`, `audio`, `document`) and URL validation (SSRF prevention)
- `src/auth.js` — Timing-safe API key comparison via `crypto.timingSafeEqual`
- `src/public/` — Retro terminal-style dashboard UI (polls status every 3s; API key stored in memory only)
- `API_DOCS.md` — Full API reference with request/response examples
