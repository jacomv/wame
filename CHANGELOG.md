# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-09-07

Upgrades Baileys to 7.0.0-rc14. This fixes messages stuck on "Esperando el
mensaje" for contacts WhatsApp has migrated to LID addressing — which, on the
6.7.x branch, has no fix at all.

### Fixed

- **Messages never delivered to LID-addressed contacts.** Confirmed from a live
  instance, not inferred:

  ```
  [retry] devocional msg=3EB08BDCEF665C0A9195A7 attempt=1/5 to=17927310987408@lid participant=12829671309370@lid addressing=LID cache=HIT
  [retry] devocional msg=3EB08BDCEF665C0A9195A7 attempt=2/5 to=17927310987408@lid participant=17927310987408@lid addressing=LID cache=HIT — el reenvío anterior no se descifró
  ```

  The send was logged against `573004211788@s.whatsapp.net`, but the retry
  receipts came back addressed by LID. WAME encrypted to the phone-number
  identity while the recipient decrypted expecting the LID one, and Baileys
  6.7.x ships **no LID↔PN mapping to translate between them** — `lib/Signal/`
  contains no `lid-mapping.js` on that branch. `cache=HIT` on both attempts
  rules out the message cache, and the resend used a session rebuilt from fresh
  prekeys (`assertSessions(jids, force)` refetches unconditionally), which rules
  out the crypto. Only the addressing was left.

  7.x adds `LIDMappingStore` and wires `getLIDForPN` into the retry path, and
  turns on `enableAutoSessionRecreation` and `enableRecentMessageCache` by
  default.

### Changed

- **Baileys pinned to the exact version `7.0.0-rc14`**, not a range. It is a
  prerelease, so a range could silently pull an rc15 with unknown changes.
  Upstream now tags 6.7.24 as `legacy` and 7.0.0-rc as `latest`, so 6.7.x is
  not a branch that will grow LID support.
- **`check-number` reads `lid` from two places.** 6.7.x returned it inside
  `onWhatsApp()`; 7.x does not — the mapping now lives in
  `signalRepository.lidMapping`. The route tries both, so it works on either
  version and degrades to `null` rather than failing the request.

### Verified before merging

- All seven Baileys exports WAME imports, and all ten `SocketConfig` options it
  passes, exist unchanged in 7.x. `newsletterMetadata`,
  `groupFetchAllParticipating` and `profilePictureUrl` keep their signatures.
  Node engine is `>=20` in both.
- **No QR re-scan needed.** `socket.js:764` emits `creds.update` with the
  account's own LID on login, and `socket.js:855` applies it with
  `Object.assign(creds, update)` — the same object reference
  `useSQLiteAuthState` serializes, so `saveCreds()` persists it. The new
  `lid-mapping`, `device-list` and `tctoken` key types store plain values, which
  the generic `${type}-${id}` JSON store already handles without changes.
- 99 tests pass. A real socket was constructed against WhatsApp under 7.x with
  WAME's exact config and completed the Noise handshake through to QR emission.
- **Not verified, and unverifiable without production traffic:** restoring an
  authenticated 6.7.x session under 7.x, and actual delivery to the LID contact.
  Rollback is `npm pkg set` back to `~6.7.24` plus `npm install`. Extra credential
  fields and key types written by 7.x are simply never queried by 6.7.x, so
  rolling back does not invalidate the session — it returns to the previous
  behaviour, not to a worse one.

## [1.3.1] — 2026-09-07

Diagnostic release. "Esperando el mensaje" was reported again on 1.3.0 and
took several rounds of cross-referencing timestamps by hand to get to a
"probably", because the logs could not answer the question.

### Added

- **Every retry receipt is now logged**, one line per request, unconditionally:

  ```
  [retry] devocional msg=3EB0A1 attempt=2/5 to=…@s.whatsapp.net participant=…@lid addressing=LID cache=HIT
  ```

  `attempt=N/5` is the field that was missing. It distinguishes "the retry never
  arrived" from "it arrived and the original was gone" from "we resent it and it
  failed again" — three causes with three different fixes, previously
  indistinguishable. It also warns when Baileys reaches `maxMsgRetryCount` and
  silently stops resending, which is where a stuck message actually dies.

  `addressing` classifies the target as `PN`/`LID`/`GROUP`/`NEWSLETTER`. This
  matters because the libsignal session dumps already present in the logs print
  crypto material — `registrationId`, `remoteIdentityKey`, raw buffers — and
  **never a JID**, so they cannot answer which address is being encrypted to.

- **`BAILEYS_LOG_LEVEL`** (default `silent`, no behaviour change) exposes the
  Baileys logger for deeper inspection. The `[retry]` lines are deliberately
  *not* behind it: the libsignal dumps are `console.info` from
  `session_record.js:273` and cannot be silenced by pino anyway, so the useful
  lines should not be the ones that are off.

- **`check-number` now returns `lid`.** `onWhatsApp()` returns the contact's LID
  identity alongside `jid` and the route was discarding it. Baileys 6.7.x ships
  no LID↔PN mapping at all (`lib/Signal/lid-mapping.js` exists only in
  7.0.0-rc), so a LID-addressed contact is a plausible cause of recipient-side
  decryption failure — and this is the field that shows it.

### Notes

No fix for the underlying stuck-message cause, because it is not yet confirmed.
This release is what makes it confirmable in one look instead of forty minutes.

## [1.3.0] — 2026-09-07

Adds WhatsApp channels (newsletters). You can now publish text, images, audio
and documents to a channel the account administers, through the same instance
that already sends direct and group messages.

### Added

- **Channel endpoints** under `/instances/:name/newsletters`: register a channel
  by JID or invite code, list registered channels, read a channel's metadata and
  role, publish to it, and unregister it. Full reference in
  [API_DOCS.md](./API_DOCS.md#channels-newsletters).
- **A local channel registry** (SQLite `newsletters` table). This is not a
  design preference — Baileys cannot enumerate the channels an account belongs
  to. It has `groupFetchAllParticipating()` for groups and
  `communityFetchAllParticipating()` for communities, but no channel
  equivalent, in neither 6.7.x nor the 7.0.0-rc branch, and WhatsApp does not
  include channels in the history sync WAME requests. So a channel is added
  once by JID or invite and refreshed from then on.
- **Publishing-role check.** Only `ADMIN` and `OWNER` may post to a channel.
  The role is verified live before each publish, so a `SUBSCRIBER` gets a `403`
  explaining why instead of the opaque server error WhatsApp returns.
- **`NEWSLETTER_INBOUND`** environment variable (default `false`). Channel
  messages reaching the `messages` webhook is opt-in: an account typically
  follows dozens of third-party channels, and every post in every one of them
  would fire the webhook. Publishing works regardless of this setting. Incoming
  message payloads now carry `isNewsletter`.

### Fixed

- **Channels were actively unreachable.** `manager.js` passed
  `shouldIgnoreJid: (jid) => jid?.endsWith('@newsletter')`, so anything
  channel-related was dropped on arrival. It is now tied to
  `NEWSLETTER_INBOUND` — and, since `shouldIgnoreJid` only filters inbound
  traffic, publishing was never affected by it.
- **`^6.7.16` resolved to a three-year-old build.** The Baileys maintainers
  mispublished `6.17.16` (an old CommonJS build, 4 March 2025, 35 minutes
  before `6.7.16`). Semver reads `6.17.16` as newer than every `6.7.x`, so it
  is the highest version matching `^6.7.16` — a fresh `npm install` pulled it
  instead of `6.7.24`. Docker builds using `npm ci` were protected by the
  lockfile; anyone running `npm install` or `npm update` was not. The range is
  now `~6.7.24`, which cannot reach it.

### Changed

- **Baileys 6.7.21 → 6.7.24.** Two upstream fixes, no API changes: spoofed
  self-only protocol messages (history sync, app-state key share, LID
  migration) are now dropped unless they come from our own device, and `fromMe`
  is checked against both the PN and LID identities so peer-routed self stanzas
  are no longer misread as someone else's.
- `requireOwnership` and the send rate limiter moved to `src/utils/guards.js`.
  Channel publishing shares the `SEND_RATE_LIMIT` budget with
  `POST /instances/:name/send` deliberately — a second limiter would have
  doubled the effective send quota.

## [1.2.0] — 2026-07-27

Adds version visibility to the dashboard. Until now there was no way to tell
which version an instance was running without shelling into the container,
which made bug reports hard to act on and deploys hard to confirm.

### Added

- **Version shown in the dashboard sidebar**, linking to the changelog.
- **Update notice.** When a newer release exists on GitHub, the sidebar shows a
  banner with the version, the exact update command
  (`docker compose pull && docker compose up -d`) and a link to the release
  notes. It is a notification only — there is deliberately no in-app updater,
  since self-updating a container requires mounting the Docker socket, which
  would hand host-level access to anyone who compromises the panel.
- **`GET /version`** returning the running version and update status. It
  requires authentication on purpose: `/health` is public, and announcing the
  version there tells anyone which known vulnerabilities to try.
- **`UPDATE_CHECK`** environment variable (default `true`). Set it to `false`
  and the install makes no outbound calls at all — this also covers the
  dependency check, which previously phoned npm on every boot with no opt-out.

### Fixed

- **The update checker recommended prereleases.** `isNewer()` parsed
  `7.0.0-rc13` into `NaN` components and reported it as a newer stable release,
  so startup logs were suggesting an upgrade to a Baileys release candidate on a
  production gateway. Prereleases are now never offered as updates, and a stable
  release correctly supersedes a prerelease of the same version.

### Changed

- GitHub release lookups are cached for 6 hours, so many dashboard loads cost a
  single API call and stay well inside the unauthenticated rate limit. Failures
  are silent by design — the panel works the same with no internet.

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

[1.2.0]: https://github.com/Jacobisaldana/wame/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Jacobisaldana/wame/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/Jacobisaldana/wame/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Jacobisaldana/wame/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Jacobisaldana/wame/releases/tag/v1.0.0
