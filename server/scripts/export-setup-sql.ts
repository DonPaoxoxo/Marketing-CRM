/** Builds one SQL file that sets up the database without a connection.
 *
 *  For when the database can only be reached through a web panel: import the
 *  file in aaPanel's phpMyAdmin and the result is identical to running
 *  `db:migrate` then `db:seed-config` — including the ledger row, so a later
 *  `db:migrate` on the server sees the schema as already applied rather than
 *  trying to create every table a second time.
 *
 *  Deliberately excludes users. Invite links carry the address people open them
 *  at and expire after `INVITE_TTL_HOURS`; created now, from this machine, they
 *  would point at localhost and lapse before the site is live. Accounts are
 *  seeded on the server with `npm run seed:users` once `APP_ORIGIN` is the real
 *  domain.
 *
 *  Contains no secrets, so it is safe to open and read before importing.
 *  No database import, and no `env` import: it must run with no `.env` at all. */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countries, platforms } from '../../src/mocks/seed';
import { LEDGER_DDL, LEDGER_TABLE } from '../db/ledger';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, '..', 'db', 'migrations');
const OUT = path.join(HERE, '..', '..', 'setup.import.sql');

/** A MySQL string literal. Every value in this file goes through here — the
 *  import has no parameter binding to lean on, so escaping is the only guard. */
export function sqlString(value: string): string {
  const escaped = value.replace(/[\0\n\r\b\t\x1a'"\\]/g, (ch) => {
    switch (ch) {
      case '\0': return '\\0';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\b': return '\\b';
      case '\t': return '\\t';
      case '\x1a': return '\\Z';
      default: return `\\${ch}`;
    }
  });
  return `'${escaped}'`;
}

/** UTC timestamp in the `DATETIME(3)` literal form. */
const sqlNow = (): string => sqlString(new Date().toISOString().replace('T', ' ').replace('Z', ''));

export async function buildSetupSql(): Promise<string> {
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  const parts: string[] = [];

  parts.push(
    '-- Marketing Resource CRM: schema and configuration.',
    `-- Generated ${new Date().toISOString()} by server/scripts/export-setup-sql.ts.`,
    '-- Import into the `marketingcrm` database. Contains no passwords or accounts.',
    '-- Stops at the first error: if a table already exists, this database is not empty.',
    '',
    'SET NAMES utf8mb4;',
    '',
    `${LEDGER_DDL};`,
    '',
  );

  for (const file of files) {
    parts.push(`-- ── ${file} ${'─'.repeat(Math.max(0, 60 - file.length))}`, '');
    parts.push((await readFile(path.join(MIGRATIONS, file), 'utf8')).trim(), '');
    parts.push(
      `INSERT INTO ${LEDGER_TABLE} (name, applied_at) VALUES (${sqlString(file)}, ${sqlNow()});`,
      '',
    );
  }

  parts.push('-- ── Configuration: countries and platforms ─────────────────────', '');
  for (const c of countries) {
    parts.push(
      `INSERT INTO countries (code, name, dial_code) VALUES (${sqlString(c.code)}, ${sqlString(c.name)}, ${sqlString(c.dialCode)})` +
      ' ON DUPLICATE KEY UPDATE name = VALUES(name), dial_code = VALUES(dial_code);',
    );
  }
  parts.push('');
  for (const p of platforms) {
    parts.push(
      'INSERT INTO platforms (id, name, slug, supports_asset_types, built_in) VALUES ' +
      `(${sqlString(p.id)}, ${sqlString(p.name)}, ${sqlString(p.slug)}, ` +
      `${sqlString(JSON.stringify(p.supportsAssetTypes))}, ${p.builtIn ? 1 : 0})` +
      ' ON DUPLICATE KEY UPDATE name = VALUES(name), slug = VALUES(slug),' +
      ' supports_asset_types = VALUES(supports_asset_types), built_in = VALUES(built_in);',
    );
  }
  parts.push('');

  return parts.join('\n');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('server/scripts/export-setup-sql.ts')) {
  const sql = await buildSetupSql();
  await writeFile(OUT, sql, 'utf8');
  console.log(
    `Wrote ${path.relative(process.cwd(), OUT)}: ${countries.length} countries, ${platforms.length} platforms, ` +
    'the full schema, and the migration ledger.',
  );
}
