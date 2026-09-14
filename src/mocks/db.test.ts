import { beforeEach, describe, expect, it } from 'vitest';
import { db, diffRecords, loadFixtures, nextId, recordAudit, resetDb } from './db';

beforeEach(() => loadFixtures());

describe('audit trail', () => {
  const actor = { id: 'TM-01', name: 'Priya Raghunathan', email: 'p@x.test', role: 'System Administrator' as const, title: 'Head of Marketing Ops', active: true };

  it('records actor, timestamp, record, action, reason and field changes', () => {
    const entry = recordAudit({
      actor, recordType: 'Domain', recordId: 'DOM-0001', recordLabel: 'example.co.in',
      action: 'rotation', reason: 'Scheduled rotation',
      changes: [{ field: 'rotationDate', from: '2026-01-01', to: '2026-09-12' }],
    });
    expect(entry.actorName).toBe(actor.name);
    expect(entry.actorRole).toBe('System Administrator');
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.reason).toBe('Scheduled rotation');
    expect(entry.changes[0]).toEqual({ field: 'rotationDate', from: '2026-01-01', to: '2026-09-12' });
    expect(db.auditEntries[0].id).toBe(entry.id);
  });

  it('redacts values for any field whose name suggests a secret', () => {
    const entry = recordAudit({
      actor, recordType: 'Credential Reference', recordId: 'CRD-0001', recordLabel: 'vault://x',
      action: 'rotation', reason: 'Rotated',
      changes: [
        { field: 'password', from: 'old-value', to: 'new-value' },
        { field: 'sessionCookie', from: 'abc', to: 'def' },
        { field: 'recovery_code', from: '111', to: '222' },
        { field: 'vaultRef', from: 'vault://a', to: 'vault://b' },
      ],
    });
    const byField = Object.fromEntries(entry.changes.map((c) => [c.field, c]));
    for (const f of ['password', 'sessionCookie', 'recovery_code']) {
      expect(byField[f].from).toBe('[redacted]');
      expect(byField[f].to).toBe('[redacted]');
    }
    // A vault *reference* is not a secret and stays legible.
    expect(byField.vaultRef.to).toBe('vault://b');
    expect(JSON.stringify(entry)).not.toContain('old-value');
  });
});

describe('record diffing', () => {
  it('reports only fields that actually changed, ignoring bookkeeping fields', () => {
    const before = { id: 'DOM-1', domainName: 'a.in', status: 'Active', updatedAt: 'x', notes: '' };
    const changes = diffRecords(before, { status: 'Inactive', updatedAt: 'y', notes: '' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'status', from: 'Active', to: 'Inactive' });
  });

  it('treats empty string and null as the same absence', () => {
    expect(diffRecords({ rotationDate: null } as Record<string, unknown>, { rotationDate: '' })).toHaveLength(0);
  });
});

describe('id allocation', () => {
  it('continues the existing numbering without collisions', () => {
    expect(nextId('DOM', [{ id: 'DOM-0007' }, { id: 'DOM-0012' }])).toBe('DOM-0013');
    expect(nextId('AGT', [{ id: 'AGT-009' }], 3)).toBe('AGT-010');
    expect(nextId('SIM', [])).toBe('SIM-0001');
  });

  it('never reuses an id already in the register', () => {
    const id = nextId('DOM', db.domains);
    expect(db.domains.length).toBeGreaterThan(0);
    expect(db.domains.some((d) => d.id === id)).toBe(false);
  });

  it('starts numbering from one in the shipped, empty workspace', () => {
    resetDb();
    expect(db.domains).toHaveLength(0);
    expect(nextId('DOM', db.domains)).toBe('DOM-0001');
  });
});
