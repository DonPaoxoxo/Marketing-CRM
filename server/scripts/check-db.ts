/** Proves which database `.env` actually points at, before anything writes to it.
 *
 *  This exists because of a near miss: XAMPP listens on `127.0.0.1:3306` on the
 *  development machine, the aaPanel MariaDB listens on `127.0.0.1:3306` on the
 *  server, and a tunnel makes them look identical from the client. Migrating into
 *  the wrong one succeeds, which is the worst possible outcome — 18 tables in a
 *  database nobody will ever look at, and a workspace that seems to work until
 *  the day it is deployed.
 *
 *  Reports identity, not just reachability. Read-only: it creates nothing. */

import type { RowDataPacket } from 'mysql2/promise';
import { closePool, query, queryOne } from '../db/pool';
import { env } from '../env';

/** Server variables worth seeing, each optional: a restricted user may be denied
 *  some of them, and that is not a reason to fail the check. */
async function serverVariable(name: string): Promise<string> {
  try {
    const row = await queryOne<RowDataPacket>(`SELECT @@${name} AS value`);
    return row?.value === null || row?.value === undefined ? '(null)' : String(row.value);
  } catch {
    return '(not readable by this user)';
  }
}

async function main(): Promise<void> {
  console.log(`\nConnecting to ${env.DB_HOST}:${env.DB_PORT} as ${env.DB_USER}…\n`);

  const identity = await queryOne<RowDataPacket>(
    'SELECT DATABASE() AS db, VERSION() AS version, CURRENT_USER() AS whoami',
  );
  const database = String(identity?.db ?? '');
  const version = String(identity?.version ?? '');

  const [hostname, datadir, port] = await Promise.all([
    serverVariable('hostname'),
    serverVariable('datadir'),
    serverVariable('port'),
  ]);

  console.log(`  Database   ${database || '(none selected)'}`);
  console.log(`  Version    ${version}`);
  console.log(`  Connected  ${String(identity?.whoami ?? '')}`);
  console.log(`  Host name  ${hostname}`);
  console.log(`  Data dir   ${datadir}`);
  console.log(`  Its port   ${port}`);

  // The data directory is the tell. A tunnel hides the address, but not this.
  const looksLocal = /xampp|laragon|wamp|[A-Za-z]:[\\/]/.test(datadir);

  console.log('');
  if (looksLocal) {
    console.log('  ⚠  That data directory is a Windows path.');
    console.log('     This is a MySQL on this machine, not the aaPanel server.');
    console.log('     If you meant to reach the server, the tunnel is not up, or');
    console.log('     DB_PORT in .env is pointing past it. Do not migrate.\n');
  } else if (datadir.startsWith('/')) {
    console.log('  ✓  Unix data directory — this is a Linux server, not XAMPP.\n');
  }

  const tables = await query<RowDataPacket>(
    `SELECT table_name AS name, table_rows AS approx_rows
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
      ORDER BY table_name`,
  );

  if (!tables.length) {
    console.log('  No tables yet. A fresh database, ready for db:migrate.\n');
  } else {
    console.log(`  ${tables.length} table(s) already present:\n`);
    for (const t of tables) {
      console.log(`    ${String(t.name).padEnd(22)} ~${String(t.approx_rows ?? 0)} rows`);
    }
    console.log('');
  }

  if (database !== env.DB_NAME) {
    console.log(`  ⚠  Connected to "${database}", but .env says DB_NAME=${env.DB_NAME}.\n`);
  }
}

main()
  .then(closePool)
  .catch(async (error: Error) => {
    console.error(`\nCould not check the database: ${error.message}\n`);
    await closePool();
    process.exit(1);
  });
