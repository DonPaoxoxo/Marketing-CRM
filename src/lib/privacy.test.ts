import { describe, expect, it } from 'vitest';
import { toCSV, type ExportColumn } from './csv';
import { recordAudit, loadFixtures, db } from '@/mocks/db';
import { maskEmail, maskPhone } from './utils';

interface Row { id: string; phone: string; email: string; brand: string }
const rows: Row[] = [{ id: 'SIM-0001', phone: '+919876543210', email: 'a.person@example.test', brand: 'Aurora' }];

const columns: ExportColumn<Row>[] = [
  { key: 'id', header: 'ID', value: (r) => r.id },
  { key: 'phone', header: 'Phone number', value: (r) => r.phone, sensitive: true, masked: (r) => maskPhone(r.phone) },
  { key: 'email', header: 'Email', value: (r) => r.email, sensitive: true, masked: (r) => maskEmail(r.email) },
  { key: 'brand', header: 'Brand', value: (r) => r.brand },
];

describe('exports mask contact details unless asked otherwise', () => {
  it('masks by default', () => {
    const csv = toCSV(rows, columns);
    expect(csv).not.toContain('+919876543210');
    expect(csv).not.toContain('a.person@example.test');
    expect(csv).toContain(maskPhone('+919876543210'));
    expect(csv).toContain('SIM-0001');       // non-sensitive columns are untouched
    expect(csv).toContain('Aurora');
  });

  it('includes them only when explicitly opted in', () => {
    const csv = toCSV(rows, columns, { includeContactDetails: true });
    expect(csv).toContain('+919876543210');
    expect(csv).toContain('a.person@example.test');
  });

  it('falls back to a placeholder when a sensitive column has no mask', () => {
    const csv = toCSV(rows, [{ key: 'phone', header: 'Phone number', value: (r) => r.phone, sensitive: true }]);
    expect(csv).toContain('[masked]');
    expect(csv).not.toContain('+919876543210');
  });

  it('still refuses credential columns regardless of the contact opt-in', () => {
    const csv = toCSV(
      [{ ...rows[0], password: 'hunter2' } as Row & { password: string }],
      [...columns, { key: 'password', header: 'Password', value: (r) => (r as Row & { password: string }).password }],
      { includeContactDetails: true },
    );
    expect(csv).not.toContain('hunter2');
    expect(csv).not.toContain('Password');
  });
});

describe('the audit trail is not a phone book', () => {
  const actor = { id: 'TM-01', name: 'A Person', email: '', role: 'System Administrator' as const, title: '', active: true };

  it('redacts contact values while still recording that they changed', () => {
    loadFixtures();
    const entry = recordAudit({
      actor, recordType: 'SIM', recordId: 'SIM-0001', recordLabel: 'SIM-0001',
      action: 'update', reason: 'Number corrected',
      changes: [
        { field: 'phoneNumber', from: '+919876543210', to: '+919876543211' },
        { field: 'contactNumber', from: '+628110000001', to: '+628110000002' },
        { field: 'email', from: 'old@example.test', to: 'new@example.test' },
        { field: 'provider', from: 'Airtel', to: 'Jio' },
      ],
    });

    const byField = Object.fromEntries(entry.changes.map((c) => [c.field, c]));
    for (const field of ['phoneNumber', 'contactNumber', 'email']) {
      expect(byField[field].from, field).toBe('[redacted]');
      expect(byField[field].to, field).toBe('[redacted]');
    }
    // The fact of the change is preserved — only the value is withheld.
    expect(entry.changes.map((c) => c.field)).toContain('phoneNumber');
    // Non-personal fields stay legible.
    expect(byField.provider).toMatchObject({ from: 'Airtel', to: 'Jio' });

    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain('+919876543210');
    expect(serialised).not.toContain('old@example.test');
  });

  it('labels a SIM audit entry by its record id, never its number', () => {
    loadFixtures();
    const numbers = db.sims.map((s) => s.phoneNumber);
    const simEntries = db.auditEntries.filter((e) => e.recordType === 'SIM');
    for (const entry of simEntries) {
      expect(numbers).not.toContain(entry.recordLabel);
    }
  });
});
