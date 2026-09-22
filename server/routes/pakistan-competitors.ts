/** Pakistan Competitor register: where a competitor is found on each platform
 *  and how to reach them. No metrics — see server/routes/growth.ts for that. */

import { Router } from 'express';
import type { CompetitorRecord } from '../../src/lib/types';
import { COMPETITOR_FIELDS, sanitizeFields } from '../../src/lib/sanitize';
import { execute, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, forbidden, notFound } from '../http/errors';
import { hasPermission } from '../../src/lib/permissions';
import {
  COMPETITOR_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readCompetitor,
} from '../repositories/records';
import { actorOf, assertMayArchive, bodyOf, nowDate } from './helpers';

export const pakistanCompetitorsRouter = Router();

type CompetitorBody = Partial<CompetitorRecord> & { reason?: string };

pakistanCompetitorsRouter.post('/', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<CompetitorBody>(req), COMPETITOR_FIELDS);
  const linkOrDomain = body.linkOrDomain?.trim() ?? '';
  if (!linkOrDomain) throw badRequest('A link or domain is required.', { field: 'linkOrDomain' });
  if (!body.platformId) throw badRequest('Select a platform.', { field: 'platformId' });

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('CMP', conn);
    const now = nowDate();
    const values = {
      ...pick(body, COMPETITOR_COLUMNS),
      linkOrDomain,
      whatsapp: body.whatsapp ?? '',
      telegram: body.telegram ?? '',
      others: body.others ?? '',
      notes: body.notes ?? '',
      archived: false,
    };
    const insert = buildInsert('pakistan_competitors', COMPETITOR_COLUMNS, values, { id, created_at: now, updated_at: now });
    await execute(insert.sql, insert.params, conn);

    await recordAudit(conn, {
      actor, recordType: 'Pakistan Competitor', recordId: id, recordLabel: linkOrDomain, action: 'create',
      reason: body.reason ?? 'Competitor added to register',
      changes: [{ field: 'linkOrDomain', from: null, to: linkOrDomain }],
    });
    return readCompetitor(id, conn);
  });

  res.status(201).json(record);
}));

pakistanCompetitorsRouter.patch('/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readCompetitor(id);
  if (!before) throw notFound('Competitor not found.');

  const body = sanitizeFields(bodyOf<CompetitorBody>(req), COMPETITOR_FIELDS);
  if (body.linkOrDomain !== undefined) {
    body.linkOrDomain = body.linkOrDomain.trim();
    if (!body.linkOrDomain) throw badRequest('A link or domain is required.', { field: 'linkOrDomain' });
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, COMPETITOR_COLUMNS);
  assertMayArchive(req, patch, reason);
  const restoring = patch.archived === false && before.archived;
  if (restoring) {
    if (!hasPermission(req.user, 'archive:records')) throw forbidden(`Your role (${req.user!.role}) cannot restore records.`);
    if (!reason?.trim()) throw badRequest('Restoring needs a written reason.', { field: 'reason' });
  }

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('pakistan_competitors', COMPETITOR_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Pakistan Competitor', recordId: id, recordLabel: body.linkOrDomain ?? before.linkOrDomain,
        action: restoring ? 'restore' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Competitor record updated',
        changes,
      });
    }
    return readCompetitor(id, conn);
  });

  res.json(record);
}));
