/** The column maps against the schema they claim to describe.
 *
 *  Nothing else connects the two. A column renamed in the migration, or a field
 *  mapped to a column that was never created, would otherwise surface as a save
 *  that fails in front of whoever is using the register — and only for that one
 *  field, which is the hardest kind of fault to notice. */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_COLUMNS, AGENT_COLUMNS, ASSIGNMENT_COLUMNS, CONTENT_POST_COLUMNS, CREDENTIAL_COLUMNS,
  DOMAIN_COLUMNS, SIM_COLUMNS, type ColumnMap,
} from './statements';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));
const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(`${MIGRATIONS}/${f}`, 'utf8'));
const schema = migrations[0];

/** The column names declared for one table.
 *
 *  A deliberately small parser: it reads the lines of a CREATE TABLE body that
 *  start with an identifier and a type, which is every column and none of the
 *  keys or constraints. */
function columnsOf(table: string): Set<string> {
  const start = schema.indexOf(`CREATE TABLE ${table} (`);
  if (start === -1) throw new Error(`No CREATE TABLE for "${table}" in the migration.`);
  const body = schema.slice(start, schema.indexOf('ENGINE=InnoDB', start));

  const names = new Set<string>();
  for (const line of body.split('\n').slice(1)) {
    const match = /^\s{2}([a-z][a-z0-9_]*)\s+[A-Z]/.exec(line);
    if (match) names.add(match[1]);
  }
  // Columns added later: "ALTER TABLE <table> ... ADD COLUMN <name>".
  for (const sql of migrations.slice(1)) {
    const alter = new RegExp(`ALTER TABLE ${table}\\b([\\s\\S]*?);`, 'g');
    for (const [, clauses] of sql.matchAll(alter)) {
      for (const [, name] of clauses.matchAll(/ADD COLUMN\s+([a-z][a-z0-9_]*)/g)) names.add(name);
    }
  }
  return names;
}

const TABLES: [string, string, ColumnMap][] = [
  ['sims', 'SIM_COLUMNS', SIM_COLUMNS],
  ['agents', 'AGENT_COLUMNS', AGENT_COLUMNS],
  ['social_accounts', 'ACCOUNT_COLUMNS', ACCOUNT_COLUMNS],
  ['credentials', 'CREDENTIAL_COLUMNS', CREDENTIAL_COLUMNS],
  ['assignments', 'ASSIGNMENT_COLUMNS', ASSIGNMENT_COLUMNS],
  ['domains', 'DOMAIN_COLUMNS', DOMAIN_COLUMNS],
  ['content_posts', 'CONTENT_POST_COLUMNS', CONTENT_POST_COLUMNS],
];

describe('column maps match the migration', () => {
  it('parses the schema it is checking against', () => {
    // Guards the parser itself: a regex that matched nothing would make every
    // test below pass for the wrong reason.
    expect(columnsOf('sims')).toContain('phone_number');
    expect(columnsOf('sims').size).toBeGreaterThan(10);
    expect(columnsOf('sims')).not.toContain('PRIMARY');
  });

  it.each(TABLES)('%s has every column %s writes to', (table, _name, map) => {
    const actual = columnsOf(table);
    for (const spec of Object.values(map)) {
      expect(actual).toContain(typeof spec === 'string' ? spec : spec.col);
    }
  });

  it.each(TABLES)('%s: every writable column is reachable through %s', (table, _name, map) => {
    // The other direction. A column the schema has but no field writes to is
    // either dead weight or a field that was forgotten — both worth knowing.
    // The four below are owned by the server, never by a request.
    const serverOwned = new Set(['id', 'created_at', 'updated_at', 'archived']);
    // Written only by their own System Administrator route (PATCH /api/agents/:id/salary), never by an ordinary edit.
    if (table === 'agents') for (const c of ['salary_status', 'salary_note', 'salary_updated_by_name', 'salary_updated_at']) serverOwned.add(c);
    const mapped = new Set(Object.values(map).map((s) => (typeof s === 'string' ? s : s.col)));

    const unreachable = [...columnsOf(table)].filter((c) => !mapped.has(c) && !serverOwned.has(c));
    expect(unreachable).toEqual([]);
  });
});
