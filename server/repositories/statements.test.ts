import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_COLUMNS, AGENT_COLUMNS, ASSIGNMENT_COLUMNS, CONTENT_POST_COLUMNS, CREDENTIAL_COLUMNS,
  DOMAIN_COLUMNS, SIM_COLUMNS, buildInsert, buildUpdate, diffRecords, pick,
} from './statements';

describe('pick', () => {
  it('keeps only fields the entity stores', () => {
    const picked = pick(
      { provider: 'Airtel', reason: 'because', archived: true, notAColumn: 1 } as Record<string, unknown>,
      SIM_COLUMNS,
    );
    expect(picked).toEqual({ provider: 'Airtel', archived: true });
  });

  it('is the guard against an unexpected key reaching SQL', () => {
    // The whole point: a request that names a column the client should not be
    // setting cannot get one into the statement, because the statement is built
    // from the map rather than from the body.
    const hostile = { id: 'SIM-9999', created_at: '1970-01-01', archived: true };
    const insert = buildInsert('sims', SIM_COLUMNS, pick(hostile, SIM_COLUMNS), {
      id: 'SIM-0001', created_at: 'now', updated_at: 'now',
    });
    expect(insert.sql).toBe('INSERT INTO sims (archived, id, created_at, updated_at) VALUES (?, ?, ?, ?)');
    expect(insert.params).toEqual([1, 'SIM-0001', 'now', 'now']);
  });
});

describe('buildInsert', () => {
  it('emits one placeholder per value and never interpolates', () => {
    const insert = buildInsert('domains', DOMAIN_COLUMNS, {
      domainName: "bobby'; DROP TABLE domains;--",
      registeredDate: '2026-01-01',
      expirationDate: '2027-01-01',
    }, { id: 'DOM-0001' });

    expect(insert.sql).not.toContain('DROP');
    expect(insert.params[0]).toBe("bobby'; DROP TABLE domains;--");
    expect(insert.sql.match(/\?/g)).toHaveLength(insert.params.length);
  });

  it('turns booleans into the TINYINT the column expects', () => {
    const insert = buildInsert('sims', SIM_COLUMNS, { archived: false }, {});
    expect(insert.params).toEqual([0]);
  });

  it('skips fields the caller did not send rather than nulling them', () => {
    const insert = buildInsert('sims', SIM_COLUMNS, { provider: 'Jio' }, {});
    expect(insert.sql).toBe('INSERT INTO sims (provider) VALUES (?)');
  });
});

describe('buildUpdate', () => {
  it('returns null when the patch touches nothing stored', () => {
    // An empty SET clause is a syntax error, so this has to be a signal rather
    // than an empty statement.
    expect(buildUpdate('sims', SIM_COLUMNS, { reason: 'just a note' }, 'SIM-0001')).toBeNull();
  });

  it('puts the id last, after the fixed columns', () => {
    const update = buildUpdate('sims', SIM_COLUMNS, { provider: 'Jio' }, 'SIM-0001', { updated_at: 'now' });
    expect(update?.sql).toBe('UPDATE sims SET provider = ?, updated_at = ? WHERE id = ?');
    expect(update?.params).toEqual(['Jio', 'now', 'SIM-0001']);
  });

  it('writes an explicit null rather than an empty string into a nullable column', () => {
    // A cleared date arrives from a form as ''. MySQL rejects that in a DATE
    // column, and '' in a foreign key violates the constraint — both mean "no
    // value", so the coercion happens here rather than in every handler.
    const update = buildUpdate('sims', SIM_COLUMNS, { planExpiryDate: '', brandId: '' }, 'SIM-0001');
    expect(update?.params).toEqual([null, null, 'SIM-0001']);
  });

  it('leaves an empty string alone in a column that is genuinely text', () => {
    const update = buildUpdate('sims', SIM_COLUMNS, { notes: '' }, 'SIM-0001');
    expect(update?.params).toEqual(['', 'SIM-0001']);
  });

  it('translates a camelCase field to its snake_case column', () => {
    // Catches a domain field renamed without its column, which would otherwise
    // only show as a value that silently stops being saved.
    const update = buildUpdate('social_accounts', ACCOUNT_COLUMNS, {
      responsibleTeamMemberId: 'TM-0001',
      followerCountMeasuredAt: '2026-09-13',
    }, 'ACC-0001');
    expect(update?.sql).toContain('responsible_user_id = ?');
    expect(update?.sql).toContain('follower_count_measured_at = ?');
  });
});

describe('column maps', () => {
  const maps = {
    SIM_COLUMNS, AGENT_COLUMNS, ACCOUNT_COLUMNS, CREDENTIAL_COLUMNS,
    ASSIGNMENT_COLUMNS, DOMAIN_COLUMNS, CONTENT_POST_COLUMNS,
  };

  it.each(Object.entries(maps))('%s names only snake_case columns', (_name, map) => {
    // A camelCase value here is a field name that was copied into the column
    // slot by mistake — the schema has no such column, so the write would fail
    // at runtime rather than here.
    for (const spec of Object.values(map)) {
      const column = typeof spec === 'string' ? spec : spec.col;
      expect(column).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it.each(Object.entries(maps))('%s maps each column only once', (_name, map) => {
    // Two fields pointing at one column would put the same column in a SET
    // clause twice, and the later value would silently win.
    const columns = Object.values(map).map((s) => (typeof s === 'string' ? s : s.col));
    expect(new Set(columns).size).toBe(columns.length);
  });

  it('never exposes a column that could hold secret material', () => {
    for (const map of Object.values(maps)) {
      for (const field of Object.keys(map)) {
        expect(field).not.toMatch(/pass|secret|token|cookie|otp|recovery_?code|backup_?code/i);
      }
    }
  });
});

describe('diffRecords', () => {
  it('records nothing when a save changes nothing', () => {
    expect(diffRecords({ provider: 'Jio', archived: false }, { provider: 'Jio' })).toEqual([]);
  });

  it('treats null and undefined as the same absence', () => {
    expect(diffRecords({ brandId: null }, { brandId: undefined })).toEqual([]);
  });

  it('compares list fields by contents, not identity', () => {
    expect(diffRecords({ simIds: ['SIM-1'] }, { simIds: ['SIM-1'] })).toEqual([]);
    expect(diffRecords({ simIds: ['SIM-1'] }, { simIds: ['SIM-2'] })).toEqual([
      { field: 'simIds', from: ['SIM-1'], to: ['SIM-2'] },
    ]);
  });

  it('reports both sides of a real change', () => {
    expect(diffRecords({ operationalStatus: 'Active' }, { operationalStatus: 'Suspended' })).toEqual([
      { field: 'operationalStatus', from: 'Active', to: 'Suspended' },
    ]);
  });
});
