# Setup

First-time setup of the database, configuration and team accounts, for local development or before a deployment.
Once `.env` exists, every command below is repeatable and safe to re-run.

- [1. Prerequisites](#1-prerequisites)
- [2. Create the database](#2-create-the-database)
- [3. Create `.env`](#3-create-env)
- [4. Confirm the connection](#4-confirm-the-connection)
- [5. Create the schema and configuration](#5-create-the-schema-and-configuration)
- [6. Create team accounts](#6-create-team-accounts)
- [7. Start the app](#7-start-the-app)
- [Alternative: import the schema through a control panel](#alternative-import-the-schema-through-a-control-panel)
- [Troubleshooting](#troubleshooting)

---

## 1. Prerequisites

- Node.js **20.19 or newer**, then `npm install` in the project folder.
- MariaDB **10.11+** or MySQL **8**.

## 2. Create the database

Create an empty database and a dedicated user for the app, for example:

```sql
CREATE DATABASE marketingcrm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'marketingcrm'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT ALL PRIVILEGES ON marketingcrm.* TO 'marketingcrm'@'localhost';
```

Keep the database user restricted to `localhost` on a server. To work against a remote database from your machine,
use an SSH tunnel rather than opening the database port:

```bash
ssh -L 3307:127.0.0.1:3306 user@your-server
```

and use port `3307` in the next step.

> **Two databases on one machine?** If a local MySQL (for example from XAMPP) already listens on 3306, a tunnel on
> 3306 cannot bind and your commands would silently hit the local server. Use a different local port for the tunnel,
> and confirm with step 4.

## 3. Create `.env`

```bash
npm run setup:env
```

It asks for the site address, database host, port, name and user, then the password **with echo turned off**. The
password is written straight into `.env` — never shown, never passed as a command-line argument, never printed. A
strong `SESSION_SECRET` is generated for you. The script refuses to overwrite an existing `.env`.

`.env` is git-ignored. Never paste its contents into an issue, a pull request, a chat or a commit.
`.env.example` lists every supported key; see the [configuration table](README.md#configuration).

## 4. Confirm the connection

```bash
npm run db:check
```

Read-only. It prints the database name, server version, the server's **data directory** and any existing tables. The
data directory tells you which server you reached even through a tunnel: a Linux path such as `/var/lib/mysql` is a
server; a Windows path such as `C:\xampp\mysql\data` means you are on a local install.

## 5. Create the schema and configuration

```bash
npm run db:migrate       # applies every migration in server/db/migrations, once, in order
npm run db:seed-config   # loads the configured countries and platforms
```

Both are idempotent. `db:migrate` records applied migrations in `schema_migrations` and skips them next time.
`db:seed-config` syncs from `src/mocks/seed.ts`; a country still used by records is kept and reported rather than removed.

## 6. Create team accounts

Accounts are created **without passwords**. Each person receives a one-time invite link and sets their own password.

**Option A — a private team file.** Copy the template and fill in real names, roles and emails:

```bash
cp server/scripts/team.example.ts server/scripts/team.local.ts
npm run seed:users
```

`team.local.ts` is git-ignored: names and email addresses are login identities and must never be committed.

**Option B — a CSV file** with `name,title,role,email` columns:

```bash
npm run seed:users -- --csv people.csv
```

Valid roles: `System Administrator`, `Marketing Manager`, `Marketing Staff`, `Read-only Reviewer`.

The seed writes the links to `invites.local.txt` (git-ignored) instead of printing them. Each link works once and
expires after `INVITE_TTL_HOURS` (72 by default), and is built from `APP_ORIGIN` — so run the seed where `APP_ORIGIN`
is the address people will actually open. Accept your own administrator link first, send each person only their own
link over a trusted channel, then delete the file. Re-running skips existing accounts.

## 7. Start the app

```bash
npm run server     # API on http://localhost:3001
npm run dev        # app on http://localhost:5173
```

The dev server proxies `/api` to the API, so both share one origin. Check the API and database at
<http://localhost:3001/api/health>, then open your invite link. The workspace starts empty — configuration only.

To enable the optional AI Assistant Learner, add `OPENROUTER_API_KEY` to `.env` and restart the API. The System
Administrator can then choose models and limits under **Shared Spiel Library → Settings**.

---

## Alternative: import the schema through a control panel

If you manage the database through a web panel (phpMyAdmin, aaPanel, cPanel) without shell access:

```bash
npm run db:export-sql
```

This writes `setup.import.sql` (git-ignored): the full schema, configuration and the migration ledger — no accounts
and no passwords. Import it into the empty database through the panel. It refuses to run twice. Accounts still need
`npm run seed:users` once the app runs where `APP_ORIGIN` is correct.

## Troubleshooting

| Message | Likely cause |
| --- | --- |
| `Invalid server configuration` | A key is missing or malformed in `.env`; the message names it |
| `ECONNREFUSED` | Nothing listens on that host and port — tunnel down or wrong port |
| `Access denied for user` | Wrong password, or the user is not allowed from where you connect |
| `Unknown database` | `DB_NAME` does not match the database you created |
| A register shows an error instead of an empty table | The API is not running or cannot reach the database; `/api/health` says which |
