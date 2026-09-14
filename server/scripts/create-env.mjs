/** Writes `.env`, interactively.
 *
 *  Run this once, before anything else:  node server/scripts/create-env.mjs
 *
 *  Plain `.mjs` with no imports beyond Node's own, on purpose — it has to run
 *  before the project is configured, which is exactly when `tsx` loading
 *  `server/env.ts` would exit complaining that the file it is about to create
 *  does not exist.
 *
 *  The database password is read with the echo turned off and goes straight into
 *  the file. It is never printed, never passed as an argument (where it would
 *  land in shell history and in the process list), and never returned to the
 *  caller. The session secret is generated here rather than invented, because a
 *  guessable one is the same as none at all. */

import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGET = path.join(ROOT, '.env');

if (existsSync(TARGET)) {
  console.error(
    '.env already exists. This script will not overwrite it — a silently replaced\n' +
    'session secret would sign every open session out.\n\n' +
    'Edit it by hand, or delete it first if you meant to start over.',
  );
  process.exit(1);
}

if (!process.stdin.isTTY) {
  console.error(
    'This needs a real terminal: it asks for the database password with the echo\n' +
    'turned off. Open a terminal in the project folder and run:\n\n' +
    '  node server/scripts/create-env.mjs',
  );
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (question, fallback) =>
  new Promise((resolve) => {
    rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `, (answer) => {
      resolve(answer.trim() || fallback || '');
    });
  });

/** Same prompt, with the typed characters suppressed.
 *
 *  readline writes each keystroke through `_writeToOutput`; replacing it for the
 *  duration of this one question is what stops the password appearing on screen
 *  and in the scrollback of whoever is watching. */
const askHidden = (question) =>
  new Promise((resolve) => {
    const restore = rl._writeToOutput;
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) restore.call(rl, text);
    };
    rl.question(`${question}: `, (answer) => {
      rl._writeToOutput = restore;
      rl.output.write('\n');
      resolve(answer);
    });
    muted = true;
  });

console.log(
  '\nSetting up .env for the Marketing Resource CRM.\n' +
  'Press Enter to accept each default in brackets.\n',
);

// The address people will open. Everything production-specific follows from it:
// an https:// site gets Secure cookies and production mode, a localhost one does
// not. Asking once avoids a live site quietly running with development settings.
const origin = (await ask('Site address', 'http://localhost:5173')).replace(/\/+$/, '');
let isLive;
try {
  const url = new URL(origin);
  isLive = url.protocol === 'https:';
  if (!isLive && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    rl.close();
    console.error(`\n${origin} is not https. A live site must use https, or sign-in cookies travel in the clear.`);
    process.exit(1);
  }
} catch {
  rl.close();
  console.error(`\n"${origin}" is not a web address. Nothing was written.`);
  process.exit(1);
}

const host = await ask('Database host', '127.0.0.1');
const port = await ask('Database port', '3306');
const name = await ask('Database name', 'marketingcrm');
const user = await ask('Database user', 'MarketingCRM');

console.log('\nThe password is not shown as you type, and is not printed anywhere.');
const password = await askHidden('Database password');

rl.close();

if (!password) {
  console.error('\nNo password entered. Nothing was written.');
  process.exit(1);
}

const secret = randomBytes(48).toString('base64url');

const contents = `# Created by server/scripts/create-env.mjs. Not in version control.
# Both values below are secrets: do not paste this file into a chat or a ticket.

${isLive
  ? 'NODE_ENV=production'
  // Omitted for a local setup: the server already defaults to development, and a
  // NODE_ENV line in .env is also read by Vite, which then builds React's
  // development bundle even for a production build.
  : '# NODE_ENV is left unset locally; the server defaults to development.'}
# 3001 is a common default and was already taken on the live server by another
# site, so a live install uses a less crowded port. Check it is free before starting.
PORT=${isLive ? 3710 : 3001}
# Loopback only: the reverse proxy is the one thing that should reach this port.
HOST=127.0.0.1

DB_HOST=${host}
DB_PORT=${port}
DB_NAME=${name}
DB_USER=${user}
DB_PASSWORD=${password}

# Signs the session cookie. Changing it signs everyone out.
SESSION_SECRET=${secret}
SESSION_TTL_HOURS=12
INVITE_TTL_HOURS=72

APP_ORIGIN=${origin}
# true for an https site, so the session cookie is never sent over plain http.
COOKIE_SECURE=${isLive}

# The in-browser mock API. Leave this off — the workspace talks to the real API.
VITE_USE_MOCK_API=false
`;

// 0o600: readable only by the account that created it. On Windows this is
// advisory — NTFS permissions are what actually apply — but it costs nothing and
// is correct everywhere else this might run.
writeFileSync(TARGET, contents, { mode: 0o600, encoding: 'utf8' });

console.log(
  `\nWrote ${path.relative(ROOT, TARGET)} — ${name} at ${host}:${port} as ${user},\n` +
  `for ${origin} (${isLive ? 'production' : 'development'}), plus a freshly generated session secret.\n\n` +
  'Next:  npm run db:check',
);
