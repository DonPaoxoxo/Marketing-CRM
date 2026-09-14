# Deployment

This guide deploys the CRM to a Linux server as a single Node.js process behind a TLS-terminating reverse proxy.
Replace `crm.example.com`, paths and ports with your own.

```
visitor ──HTTPS──▶ [optional CDN] ──HTTPS──▶ nginx ──HTTP──▶ 127.0.0.1:3710  Node (app + /api) ──▶ MariaDB
```

- [1. Server requirements](#1-server-requirements)
- [2. Build the bundle](#2-build-the-bundle)
- [3. Upload and install](#3-upload-and-install)
- [4. Configure](#4-configure)
- [5. Database](#5-database)
- [6. Run the process](#6-run-the-process)
- [7. Reverse proxy and TLS](#7-reverse-proxy-and-tls)
- [8. Team accounts](#8-team-accounts)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)
- [Production checklist](#production-checklist)

---

## 1. Server requirements

- Linux with Node.js **20.19+** (22 LTS recommended): `node -v`
- MariaDB 10.11+ or MySQL 8 on the same machine or a private network
- nginx (or another reverse proxy) with a TLS certificate for your domain
- A process manager such as PM2 or systemd (control panels like aaPanel provide one)

Put the app in its own folder **outside any web root**, for example `/srv/marketingcrm`. Anything inside a web root
can end up served as a file, and this folder holds `.env`.

## 2. Build the bundle

On your development machine:

```bash
npm run deploy:bundle
```

This builds the app and writes `deploy/marketingcrm-<timestamp>.tar.gz`. It refuses to produce an archive containing
`.env`, `node_modules`, tests, invite files or the mock API, and verifies the archive after writing it. Building
locally keeps Vite and TypeScript off a small server.

## 3. Upload and install

```bash
mkdir -p /srv/marketingcrm && cd /srv/marketingcrm
# upload the archive here, then:
tar --no-same-owner -xzf marketingcrm-<timestamp>.tar.gz
npm ci --omit=dev
```

`--no-same-owner` avoids archive ownership errors when extracting as root. Always run `npm ci` on the server —
never copy `node_modules` from another operating system: the password-hashing library is native code.

## 4. Configure

```bash
npm run setup:env
```

Use your public `https://` address as the site address. An `https://` address switches on production mode and Secure
cookies. Then review `.env`:

| Key | Production value |
| --- | --- |
| `APP_ORIGIN` | `https://crm.example.com` |
| `PORT` | A free local port, e.g. `3710` (check with `ss -lntp \| grep ':3710 '`) |
| `HOST` | `127.0.0.1` — only the proxy should reach the app |
| `TRUST_PROXY` | `1` behind nginx; `2` behind a CDN plus nginx |
| `OPENROUTER_API_KEY` | Optional, to enable the AI Assistant Learner |

Restrict the file: `chmod 600 .env`.

## 5. Database

```bash
npm run db:check         # confirm you reach the intended database
npm run db:migrate
npm run db:seed-config
```

Both write commands are idempotent, and migrations are additive.

## 6. Run the process

With PM2:

```bash
npm install -g pm2
pm2 start npm --name marketingcrm -- run server:start
pm2 save
pm2 startup              # follow the printed instruction to start on boot
```

Or define a Node project in your control panel with start command `npm run server:start` and the port above. Do not
open the app port in the firewall. Check it locally:

```bash
curl -s http://127.0.0.1:3710/api/health    # {"ok":true}
```

## 7. Reverse proxy and TLS

Example nginx server block:

```nginx
server {
    listen 443 ssl http2;
    server_name crm.example.com;

    ssl_certificate     /etc/ssl/crm.example.com/fullchain.pem;
    ssl_certificate_key /etc/ssl/crm.example.com/privkey.pem;

    # Documents in the Shared Spiel Library can be up to 20 MB.
    client_max_body_size 25m;

    location / {
        proxy_pass         http://127.0.0.1:3710;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        # AI requests are capped at 55 s by default; keep this above that cap.
        proxy_read_timeout 60s;
    }
}

server {
    listen 80;
    server_name crm.example.com;
    return 301 https://$host$request_uri;
}
```

Do not enable proxy caching. Every API response is sent with `Cache-Control: no-store`; do not override it for `/api`.

### Behind a CDN such as Cloudflare

- Set `TRUST_PROXY=2`, so rate limits see the visitor's address rather than the CDN's.
- Use **Full (strict)** TLS between the CDN and the server (for example a CDN origin certificate installed in nginx).
  A "flexible" mode sends sign-in passwords from the CDN to your server unencrypted.
- Install the origin certificate on the server *before* switching to strict mode, to avoid a certificate error in between.
- Do not add cache rules for `/api`.

Then open `https://crm.example.com/api/health` (expect `{"ok":true}`) and `https://crm.example.com` (the sign-in page).

## 8. Team accounts

On the server, where `APP_ORIGIN` is the public address, create accounts as described in
[SETUP.md → Create team accounts](SETUP.md#6-create-team-accounts). Send each person only their own invite link, then
delete `invites.local.txt`.

---

## Upgrading

1. Locally: `npm run deploy:bundle`.
2. Upload and extract over the app folder. `.env` is never in the bundle, so it survives.
3. `npm ci --omit=dev && npm run db:migrate`
4. `pm2 restart marketingcrm` (or restart the panel's Node project).
5. Hard-refresh the browser (Ctrl+F5) so the new app shell loads.

Migrations only ever add; an applied migration is never edited. Back up the database before upgrading.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `502 Bad Gateway` | The Node process is not running — check `pm2 logs marketingcrm` |
| Signed out immediately after signing in | The site was opened over `http://`, so the Secure cookie was not stored; force HTTPS |
| `413 Request Entity Too Large` on uploads | `client_max_body_size` in nginx is below `25m` |
| `504` on AI requests | `proxy_read_timeout` is lower than the AI whole-request limit |
| `Invalid server configuration` in the log | A `.env` key is missing or malformed; the log names it |
| Page loads but every register errors | Open `/api/health`: `ok:false` means the database, anything else the proxy |

## Production checklist

- [ ] App folder outside the web root; `.env` readable only by the app user
- [ ] `HOST=127.0.0.1`, app port not exposed publicly
- [ ] HTTPS enforced; strict TLS to the origin if behind a CDN
- [ ] `TRUST_PROXY` matches the number of proxies
- [ ] `client_max_body_size 25m` and `proxy_read_timeout 60s` in nginx
- [ ] No caching of `/api`
- [ ] Database user limited to the app database and to `localhost`
- [ ] Automated database backups
- [ ] `invites.local.txt` deleted after invites are sent
