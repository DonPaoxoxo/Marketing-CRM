/** Builds the app and packs exactly what the server needs into one archive.
 *
 *    npm run deploy:bundle   →   deploy/marketingcrm-<timestamp>.tar.gz
 *
 *  Upload that one file through aaPanel's file manager and extract it. Building
 *  here rather than on the server keeps Vite, TypeScript and a large dev
 *  install off a small VPS; the server only installs what runs.
 *
 *  Never packed: `.env` (each machine writes its own), `node_modules` (native
 *  modules such as argon2 must be installed for Linux, not copied from
 *  Windows), invite files, tests, and the mock API. The archive is checked for
 *  those after it is written, rather than trusting the exclude list. */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

// npm is a .cmd shim on Windows, which execFileSync can only start through a
// shell. The arguments here are fixed strings, never user input, so that is safe;
// Node may still print a DEP0190 warning about it.
const run = (cmd, args, extraEnv = {}) =>
  execFileSync(process.platform === 'win32' ? `${cmd}.cmd` : cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });

console.log('1/3  Building the browser app against the real API…\n');
rmSync('dist', { recursive: true, force: true });
// Both forced here whatever any local .env says — a variable already set when
// Vite starts outranks the .env file.
//  * VITE_USE_MOCK_API: a bundle built with the mock on would be a convincing
//    fake register on the live site.
//  * NODE_ENV: a development .env on the build machine once made Vite bundle
//    React's development build into production — larger, slower, and running
//    development-only checks for every visitor. It shipped unnoticed for a day.
run('npm', ['run', 'build'], { VITE_USE_MOCK_API: 'false', NODE_ENV: 'production' });

if (!existsSync('dist/index.html')) throw new Error('Build did not produce dist/index.html.');

// Checked on disk before packing, which works with either tar a Windows machine
// happens to have (bsdtar in System32, GNU tar from Git).
const shipsMock = readdirSync('dist/assets')
  .filter((f) => f.endsWith('.js'))
  .some((f) => readFileSync(path.join('dist/assets', f), 'utf8').includes('mockServiceWorker'));
if (shipsMock) throw new Error('Refusing to ship: the built app still contains the mock API.');

// React's development build announces itself with this message; its production
// build never contains it. Checked rather than trusted, because the NODE_ENV
// override above is exactly the kind of line a future edit could lose.
const shipsDevReact = readdirSync('dist/assets')
  .filter((f) => f.endsWith('.js'))
  .some((f) => readFileSync(path.join('dist/assets', f), 'utf8').includes('Download the React DevTools'));
if (shipsDevReact) throw new Error('Refusing to ship: the build contains React\'s development build. Build with NODE_ENV=production.');

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const out = path.join('deploy', `marketingcrm-${stamp}.tar.gz`);
mkdirSync('deploy', { recursive: true });

console.log('\n2/3  Packing…');
const include = [
  'dist',
  'server',
  'src/lib',
  'src/mocks/seed.ts',
  'package.json',
  'package-lock.json',
  'DEPLOY.md',
  'SETUP.md',
];
const exclude = [
  '*.test.ts',
  '*.test.tsx',
  'dist/mockServiceWorker.js',
  '.env',
  '.env.*',
  'invites.local.txt',
  'setup.import.sql',
  'node_modules',
];
execFileSync('tar', [
  '-czf', out,
  ...exclude.flatMap((pattern) => ['--exclude', pattern]),
  ...include,
], { stdio: 'inherit' });

console.log('3/3  Checking the archive…');
const listing = execFileSync('tar', ['-tzf', out]).toString().split('\n').filter(Boolean);
const forbidden = listing.filter((entry) =>
  /(^|\/)\.env($|\.)|node_modules\/|invites\.local|\.test\.tsx?$|mockServiceWorker|src\/mocks\/(handlers|db|browser|fixtures)/.test(entry));
if (forbidden.length) {
  rmSync(out);
  throw new Error(`Refusing to ship — the archive contained:\n  ${forbidden.join('\n  ')}`);
}
for (const required of ['dist/index.html', 'server/index.ts', 'src/lib/types.ts', 'package-lock.json']) {
  if (!listing.includes(required)) {
    rmSync(out);
    throw new Error(`Refusing to ship — ${required} is missing from the archive.`);
  }
}

const version = JSON.parse(readFileSync('package.json', 'utf8')).engines?.node ?? 'unspecified';
console.log(
  `\nReady: ${out}  (${(statSync(out).size / 1024).toFixed(0)} KB, ${listing.length} entries)\n` +
  `Needs Node ${version} on the server. See DEPLOY.md.`,
);
