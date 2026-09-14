/** Migration runner.
 *
 *  Applies every `.sql` file in `migrations/` in filename order, once, inside a
 *  transaction, recording each in `schema_migrations`. Re-running is a no-op.
 *
 *  Deliberately dependency-free: a migration tool is a thing you have to trust at
 *  3am against a production database, and this one is short enough to read. */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import { closePool, getPool, query } from './pool';
import { LEDGER_DDL } from './ledger';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureLedger(): Promise<void> {
  await getPool().query(LEDGER_DDL);
}

/** Split on semicolons that end a statement, ignoring those inside strings or
 *  comments. Enough for schema files; this is not a general SQL parser. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      else continue;
    } else if (!inSingle && !inDouble && ch === '-' && next === '-') {
      inLineComment = true;
      continue;
    } else if (!inDouble && ch === "'" && sql[i - 1] !== '\\') {
      inSingle = !inSingle;
    } else if (!inSingle && ch === '"' && sql[i - 1] !== '\\') {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export async function migrate({ log = console.log }: { log?: (m: string) => void } = {}): Promise<string[]> {
  await ensureLedger();

  const applied = new Set(
    (await query<RowDataPacket>('SELECT name FROM schema_migrations')).map((r) => String(r.name)),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    log('Schema is up to date.');
    return [];
  }

  const conn = await getPool().getConnection();
  const done: string[] = [];
  try {
    for (const file of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`Applying ${file}…`);
      // DDL in MySQL commits implicitly, so a failure part-way through one file
      // cannot be rolled back. Each file is applied on its own and the ledger is
      // written immediately after, so a re-run resumes at the right place.
      await conn.beginTransaction();
      try {
        for (const statement of splitStatements(sql)) {
          await conn.query(statement);
        }
        await conn.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, new Date()]);
        await conn.commit();
      } catch (error) {
        await conn.rollback().catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      done.push(file);
      log(`  ${file} applied.`);
    }
  } finally {
    conn.release();
  }
  return done;
}

// Run directly: `npm run db:migrate`
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('server/db/migrate.ts')) {
  migrate()
    .then(async (done) => {
      console.log(done.length ? `\n${done.length} migration(s) applied.` : '');
      await closePool();
    })
    .catch(async (error: Error) => {
      console.error(`\n${error.message}`);
      await closePool();
      process.exit(1);
    });
}
