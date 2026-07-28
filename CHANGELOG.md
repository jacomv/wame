# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — 2026-07-27

Reliability release. Fixes the long-standing bug where some messages never
reached the recipient and stayed stuck on **"Waiting for this message. This may
take a while."** Two earlier attempts (`0f88b5f`, `c0ab187`) addressed parts of
the problem; this release fixes the actual root causes.

### Fixed

- **Messages permanently stuck on "Waiting for this message".** When a recipient
  can't decrypt a message, their device sends a retry receipt and Baileys asks
  for the original through `getMessage()` to re-encrypt and resend it. The
  message cache was only populated for `messages.upsert` events of type
  `notify`, but Baileys emits **your own outgoing messages with type `append`**.
  Outgoing messages therefore never entered the cache, `getMessage()` always
  returned `undefined`, and nothing was ever resent.
- **Silent loss of Signal session keys.** `useMultiFileAuthState` rewrites each
  key file with a plain `writeFile` — no temp-file + rename, no fsync. A process
  killed mid-write leaves truncated JSON, and its read path swallows the parse
  error and returns `null`, which Baileys reads as "this key does not exist".
  The Signal session with that contact was silently lost, and every subsequent
  message to them got stuck forever.
- **CI red since 1.0.2.** The image test still asserted the pre-1.0.2 behaviour
  and reached out to a live URL. It now mocks the download and covers the
  current server-side JPEG conversion. The suite is green again (52 tests).
- **Shutdown racing Docker's SIGKILL.** The forced-exit timer was 10s, exactly
  matching Docker's default stop grace period, so a restart could kill the
  process mid-write. It is now 5s, the database is closed (checkpointing the
  WAL) on both the clean and forced paths, and a second signal no longer runs
  the shutdown twice.

### Added

- **SQLite-backed auth state** (`src/auth-state.js`), replacing
  `useMultiFileAuthState`. Key writes run inside a transaction on WAL, so an
  interrupted write rolls back instead of leaving half-written data. Existing
  file-based sessions are **migrated automatically on first start — no QR
  rescan required**; the original files are kept as a backup and never
  re-imported.
- **Persistent message cache** (`src/message-cache.js`). An in-memory LRU
  (1000 entries) backed by SQLite, so a process or container restart no longer
  loses pending retries. Expired rows are purged at startup and every 10
  minutes.
- **`MSG_CACHE_TTL_HOURS`** environment variable (default `24`) controlling how
  long a sent message is retained for retries. Lower it to reduce how long
  message content stays in the database.
- **`stop_grace_period: 30s`** in `docker-compose.yml`, giving the clean
  shutdown room to finish before Docker sends SIGKILL.
- Test coverage for the auth state and the message cache (20 new tests),
  including that `Buffer` values such as `mediaKey` and `waveform` survive the
  SQLite round-trip intact.

### Changed

- Failures that used to be invisible are now logged: an unreadable auth key, a
  retry receipt for a message missing from the cache, and an unparseable cached
  message. Previously a stuck message left no trace at all.
- The message cache TTL went from 5 minutes to 24 hours (configurable), since
  retry receipts arrive whenever the recipient's device comes back online.

### Upgrade notes

`docker compose pull && docker compose up -d`. No manual steps and no QR rescan.
**Back up the `/data` volume first**: the session migration is one-way in
practice — rolling back to 1.0.x will read the JSON files as they were at
migration time, missing any keys written afterwards.

## [1.0.2] — 2026-05-06

### Added

- Automatic `jpegThumbnail` and dimension generation for image messages, so
  previews render correctly without the caller supplying them.

## [1.0.1] — 2026-05-06

### Added

- Multi-tenant account system with registration and login; each account gets its
  own API key and only sees its own instances.
- `check-number`, `restart` and `profile-picture` endpoints.
- Restart button in the dashboard UI.

### Fixed

- Allow callers to supply a custom `jpegThumbnail` and image dimensions.
- Resolve `@lid` participants to phone numbers in group webhooks.
- Use a valid browser ID and add a `getMessage` handler, both aimed at the
  "Waiting for this message" error (fully resolved in 1.1.0).
- Harden the Baileys socket for stability and lower memory usage.
- Sync `package-lock.json` so `npm ci` works in CI.

## [1.0.0] — 2026-03-12

Initial release.

### Added

- Send text, image, audio and document messages over a REST API.
- Webhooks for incoming messages and group participant changes.
- Multi-instance support with QR pairing and session persistence.
- Embedded SQLite, no external services required.
- Dependency update checker, security hardening and rate limiting.
- Automatic phone-number normalization to JID format.

[1.1.0]: https://github.com/Jacobisaldana/wame/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/Jacobisaldana/wame/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Jacobisaldana/wame/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Jacobisaldana/wame/releases/tag/v1.0.0
