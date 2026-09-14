# Security Policy

## Reporting a vulnerability

Please **do not report security issues in public issues, discussions or pull requests.**

Report them privately through GitHub's **[Report a vulnerability](../../security/advisories/new)** button on the
repository's Security tab. Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the affected version or commit,
- any suggested fix.

You can expect an acknowledgement within a few working days. Please allow reasonable time for a fix before any public
disclosure. Do not access, modify or delete data that is not yours while investigating.

## Supported versions

Only the latest commit on `main` receives security fixes.

## Security model

The CRM is designed for internal use behind authentication. Key properties:

### Authentication and sessions

- Passwords are hashed with **Argon2**; accounts are created without passwords and activated through one-time invite
  links whose SHA-256 hash is all the database stores.
- Sessions are server-side. The browser holds an opaque, HttpOnly cookie (Secure in production); the database stores
  only the token's hash.
- Changing a password ends every other session. Sign-in attempts are rate limited.

### Authorization

- Every API route checks the session and permissions on the server. The interface reads the same permission rules
  but is never the enforcement point.
- Role permissions are editable by the System Administrator; `manage:users` cannot be granted.
- Ownership rules apply where required (Ads Monitoring records, Shared Spiel Library records): only the creator or the
  System Owner may change them. Records a caller may not see return `404`, so ids cannot be probed.

### Data handling

- **No secrets are stored.** Credential screens hold vault *references* only, labelled as not connected. Passwords,
  tokens, recovery and backup codes, session cookies and 2FA seeds are rejected in imports and excluded from exports.
- The audit trail records who changed what and why; values of credential and contact fields are redacted.
- Contact details are masked by default in the interface and in exports.
- Spreadsheet exports guard against formula injection.
- Uploaded files are validated by extension, declared type, content signature and size; executables, scripts, web
  pages and macro-enabled Office files are refused. Files are stored in the database and served only through
  authorised routes with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.

### AI features

- The OpenRouter key is read from the server environment only and is never sent to the browser, logged or stored.
- Phone numbers, email addresses and secret-looking values are redacted before text is sent to a model.
- AI endpoints cannot approve, publish, delete or reassign records. Request logs record metadata, never prompts.

### Transport and headers

- Production runs behind HTTPS; the app listens on `127.0.0.1` only.
- `helmet` security headers; API responses are `Cache-Control: no-store`; every response carries
  `X-Robots-Tag: noindex`. Crawler directives are not access control — authentication is.

## For operators

- Keep `.env` out of version control and readable only by the app user.
- Use strict TLS between any CDN and the origin, and set `TRUST_PROXY` to the number of proxies.
- Restrict the database user to the app database and to local connections, and back the database up.
- Delete `invites.local.txt` after sending invites.
- Keep dependencies up to date (`npm audit`).
