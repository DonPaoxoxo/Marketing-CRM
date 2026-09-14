/** Logging an event the client is the only witness to.
 *
 *  Exports happen in the browser: the rows are already on screen, and the file is
 *  assembled there. The server never sees the data, so it cannot log the export
 *  by observing it — the client reports that it happened. What the client may
 *  report is narrow on purpose, and who it happened as is not up to it.
 *
 *  Nothing here accepts field values: an export entry records that someone
 *  exported a named view, never what was in it. */

import { Router } from 'express';
import type { AuditEntry } from '../../src/lib/types';
import { sanitizeText } from '../../src/lib/sanitize';
import { tx } from '../db/pool';
import { recordAudit } from '../audit';
import { requireAuth } from '../auth/middleware';
import { asyncHandler, badRequest } from '../http/errors';
import { actorOf, bodyOf } from './helpers';

export const auditRouter = Router();

/** The actions a client may report about itself.
 *
 *  Everything else — creates, updates, archives, assignments — is written by the
 *  route that performed the change, where the entry is a record of something the
 *  server actually did rather than a claim. */
const CLIENT_REPORTABLE: AuditEntry['action'][] = ['export'];

type LogBody = Partial<Omit<AuditEntry, 'id' | 'timestamp' | 'actorId' | 'actorName' | 'actorRole'>>;

auditRouter.post('/', requireAuth, asyncHandler(async (req, res) => {
  const body = bodyOf<LogBody>(req);
  const action = body.action;

  if (!action || !CLIENT_REPORTABLE.includes(action)) {
    throw badRequest(
      `"${action ?? 'unknown'}" cannot be logged from the browser. Record changes are logged by the action that makes them.`,
      { field: 'action' },
    );
  }

  const actor = actorOf(req);
  const id = await tx((conn) => recordAudit(conn, {
    actor,
    recordType: sanitizeText(body.recordType, 64) || 'Export',
    recordId: sanitizeText(body.recordId, 64),
    recordLabel: sanitizeText(body.recordLabel, 200),
    action,
    reason: sanitizeText(body.reason, 600) || 'Export performed',
    // Counts and column names describe the export; values never do.
    changes: (body.changes ?? []).slice(0, 20).map((change) => ({
      field: sanitizeText(change.field, 120),
      from: null,
      to: sanitizeText(change.to, 600),
    })),
  }));

  res.status(201).json({ id });
}));
