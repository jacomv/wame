# Authentication hardening (PR #28)

## Browser sessions
- The web panel authenticates with email/password and a 12-hour HttpOnly, SameSite=Strict cookie.
- The cookie token is random and stored only as a SHA-256 digest in SQLite.
- Logging out revokes the server-side token; reloading the page restores a still-valid session.
- Cookie-authenticated POST/PUT/PATCH/DELETE operations require a same-origin Origin header.
- API clients keep using the `x-api-key` header and are not subject to browser-cookie CSRF checks.

## Registration
- New accounts require passwords of at least 12 characters. Existing password hashes are not invalidated.
- Public registration is closed by default after the first account is created.
- To allow more public registrations, set `ALLOW_REGISTRATION=true`. For closed registration, an admin API key may authorize account creation via the API.
- The first account can register without an existing admin account, allowing fresh installations to bootstrap.

## API keys
- Existing per-account API keys are automatically migrated from plaintext to SHA-256 digests on startup. The original key strings remain valid.
- Newly generated keys are stored only as digests.
- API keys are not returned by password login or browser registration.
- To rotate an account key, sign into the panel, select **Rotate API key**, and confirm the account password.
- The newly issued key is displayed once. Copy it and update every integration before dismissing it. The old key stops working immediately.
- **Back up the database before deployment**. The migration is one-way: older versions that expect plaintext account keys will no longer recognize the stored hashes.
- The global admin `API_KEY` environment variable is unchanged and remains a separate credential. Protect it and rotate it through deployment secrets.

## Deployment checks
1. Back up the SQLite database and existing environment configuration.
2. Deploy to an isolated copy with a separate `DATA_DIR` and no live WhatsApp sessions.
3. Confirm password login, refresh, logout, and rejection of unauthorized API requests.
4. Verify existing account API keys still work on the copied database.
5. Confirm that an unowned legacy instance cannot be claimed by another account.
6. Rotate a test account key and verify that the old key returns 401.
7. Validate reverse-proxy HTTPS configuration, Origin headers, and secure cookies.
8. Deploy to production only after explicit approval.

This branch does not create a release or change the package version.
