/** Writing audit entries.
 *
 *  Mirrors `recordAudit` in the mock so the history looks identical whichever is
 *  serving, and keeps the same redaction rule: the *fact* of a change is always
 *  recorded, but the values of credential and contact fields never are. */

import type { PoolConnection } from 'mysql2/promise';
import { execute } from './db/pool';
import { nextId } from './db/ids';
import type { AuditEntry, RoleName } from '../src/lib/types';

/** Values withheld from the history.
 *
 *  Two groups: credential material, which must not exist anywhere in this system;
 *  and personal contact details, which are legitimate in a register but do not
 *  belong in a permanent, widely-read log. */
const REDACTED_FIELDS =
  /pass|secret|token|cookie|session|recovery_?code|backup_?code|otp|seed|phone|contactNumber|email|recoveryRef/i;

const MAX_VALUE = 600;

function stringify(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.join(', ').slice(0, MAX_VALUE);
  return String(value).slice(0, MAX_VALUE);
}

export interface AuditInput {
  actor: { id: string; name: string; role: RoleName };
  recordType: string;
  recordId: string;
  recordLabel: string;
  action: AuditEntry['action'];
  reason: string;
  changes?: { field: string; from: unknown; to: unknown }[];
}

/** Always called with the caller's transaction, so a rolled-back write leaves no
 *  audit entry claiming it happened. */
export async function recordAudit(conn: PoolConnection, input: AuditInput): Promise<string> {
  const id = await nextId('AUD', conn);
  const now = new Date();

  await execute(
    `INSERT INTO audit_entries
       (id, actor_id, actor_name, actor_role, occurred_at, record_type, record_id, record_label, action, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.actor.id,
      // Denormalised so history stays readable after the person leaves.
      input.actor.name.slice(0, 160),
      input.actor.role,
      now,
      input.recordType.slice(0, 64),
      input.recordId.slice(0, 64),
      input.recordLabel.slice(0, 200),
      input.action,
      input.reason.slice(0, MAX_VALUE),
    ],
    conn,
  );

  const changes = input.changes ?? [];
  for (const [position, change] of changes.entries()) {
    const redact = REDACTED_FIELDS.test(change.field);
    await execute(
      'INSERT INTO audit_changes (audit_id, position, field, value_from, value_to) VALUES (?, ?, ?, ?, ?)',
      [
        id,
        position,
        change.field.slice(0, 120),
        redact ? '[redacted]' : stringify(change.from),
        redact ? '[redacted]' : stringify(change.to),
      ],
      conn,
    );
  }

  return id;
}
