import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSetupSql, sqlString } from './export-setup-sql';

describe('sqlString', () => {
  it('cannot be broken out of with a quote', () => {
    // The import file has no parameter binding, so this is the only guard.
    expect(sqlString("O'Brien'); DROP TABLE users;--")).toBe("'O\\'Brien\\'); DROP TABLE users;--'");
  });

  it('escapes the backslash itself, so it cannot unescape the closing quote', () => {
    expect(sqlString('ends with \\')).toBe("'ends with \\\\'");
  });

  it('escapes control characters MySQL treats specially', () => {
    expect(sqlString('a\nb\0c\x1a')).toBe("'a\\nb\\0c\\Z'");
  });
});

describe('buildSetupSql', () => {
  it('records every migration in the ledger, so db:migrate will not re-run it', async () => {
    const sql = await buildSetupSql();
    const migrations = readdirSync(fileURLToPath(new URL('../db/migrations', import.meta.url)))
      .filter((f) => f.endsWith('.sql'));

    expect(migrations.length).toBeGreaterThan(0);
    for (const file of migrations) {
      expect(sql).toContain(`INSERT INTO schema_migrations (name, applied_at) VALUES ('${file}'`);
    }
  });

  it('creates the ledger before recording anything in it', async () => {
    const sql = await buildSetupSql();
    expect(sql.indexOf('CREATE TABLE IF NOT EXISTS schema_migrations'))
      .toBeLessThan(sql.indexOf('INSERT INTO schema_migrations'));
  });

  it('carries no accounts and nothing secret', async () => {
    const sql = await buildSetupSql();
    expect(sql).not.toMatch(/INSERT INTO users/i);
    expect(sql).not.toMatch(/INSERT INTO sessions/i);
    expect(sql).not.toMatch(/\$argon2/);
  });
});
