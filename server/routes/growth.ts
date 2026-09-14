/** Social growth: daily follower totals and short-form content engagement.
 *
 *  Every number here is read off a platform by a person and typed in. Nothing
 *  synchronises, so each figure carries the date it was observed and the module
 *  says so wherever it is shown. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { ContentPost } from '../../src/lib/types';
import {
  CONTENT_POST_FIELDS, SNAPSHOT_FIELDS, sanitizeFields,
} from '../../src/lib/sanitize';
import { execute, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, notFound } from '../http/errors';
import {
  CONTENT_POST_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readContentPost,
} from '../repositories/records';
import { actorOf, assertMayArchive, bodyOf, nowDate, today } from './helpers';
import { keyChanged, postUrlHolder, taken } from './duplicates';
import { postUrlKey } from '../../src/lib/identity';

export const growthRouter = Router();

/* ── Follower snapshots ───────────────────────────────────────── */

/** A type alias rather than an interface so it satisfies the index-signature
 *  constraint on `sanitizeFields`, which every register body goes through. */
type BulkBody = {
  date?: string;
  entries?: { accountId: string; followerCount: number }[];
  reason?: string;
};

/** A day's numbers for many accounts in one audited action.
 *
 *  Upserts on (accountId, date): re-saving a date corrects that day rather than
 *  adding a second row, and the correction is audited with both values. The
 *  account's own follower figure is written through from its newest snapshot, so
 *  the register, the exports and this module can never show different numbers.
 *
 *  The whole day is one transaction. A grid of forty accounts that fails on the
 *  thirty-ninth must not leave thirty-eight days recorded and the operator
 *  guessing which. */
growthRouter.post('/follower-snapshots/bulk', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<BulkBody>(req), SNAPSHOT_FIELDS);
  const date = body.date ?? '';
  const entries = body.entries ?? [];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('A valid date is required.', { field: 'date' });
  if (date > today()) throw badRequest('A future date cannot have been observed yet.', { field: 'date' });
  if (!entries.length) throw badRequest('No follower numbers were submitted.');

  for (const entry of entries) {
    if (!Number.isInteger(entry.followerCount) || entry.followerCount < 0) {
      throw badRequest(
        `${entry.accountId}: a follower total must be a whole number of zero or more.`,
        { field: entry.accountId },
      );
    }
    const account = await queryOne<RowDataPacket>(
      'SELECT id FROM social_accounts WHERE id = ?', [entry.accountId],
    );
    if (!account) {
      throw badRequest(`${entry.accountId}: no such account.`, { field: entry.accountId });
    }
  }

  const actor = actorOf(req);
  const result = await tx(async (conn) => {
    let created = 0;
    let corrected = 0;
    const now = nowDate();

    for (const entry of entries) {
      const existing = await queryOne<RowDataPacket>(
        'SELECT id, follower_count FROM follower_snapshots WHERE account_id = ? AND snapshot_date = ?',
        [entry.accountId, date],
        conn,
      );

      if (existing) {
        if (Number(existing.follower_count) !== entry.followerCount) {
          await recordAudit(conn, {
            actor, recordType: 'Follower Snapshot', recordId: String(existing.id),
            recordLabel: `${entry.accountId} on ${date}`, action: 'update',
            reason: body.reason ?? 'Daily follower total corrected',
            changes: [{ field: 'followerCount', from: Number(existing.follower_count), to: entry.followerCount }],
          });
          await execute(
            'UPDATE follower_snapshots SET follower_count = ?, recorded_by_id = ?, recorded_at = ? WHERE id = ?',
            [entry.followerCount, actor.id, now, existing.id],
            conn,
          );
          corrected++;
        }
      } else {
        const id = await nextId('FSN', conn);
        await execute(
          `INSERT INTO follower_snapshots
             (id, account_id, snapshot_date, follower_count, recorded_by_id, recorded_at, note)
           VALUES (?, ?, ?, ?, ?, ?, '')`,
          [id, entry.accountId, date, entry.followerCount, actor.id, now],
          conn,
        );
        created++;
      }

      // Write through to the account, but only from its newest snapshot — a
      // back-filled older day must not overwrite a more recent total.
      await execute(
        `UPDATE social_accounts a
            JOIN (SELECT account_id, follower_count, snapshot_date
                    FROM follower_snapshots
                   WHERE account_id = ?
                   ORDER BY snapshot_date DESC
                   LIMIT 1) newest ON newest.account_id = a.id
             SET a.follower_count = newest.follower_count,
                 a.follower_count_measured_at = newest.snapshot_date,
                 a.updated_at = ?
          WHERE a.id = ?`,
        [entry.accountId, now, entry.accountId],
        conn,
      );
    }

    await recordAudit(conn, {
      actor, recordType: 'Follower Snapshot', recordId: date,
      recordLabel: `Daily follower entry for ${date}`, action: 'update',
      reason: body.reason ?? 'Daily follower numbers recorded',
      changes: [
        { field: 'accountsRecorded', from: null, to: created },
        { field: 'accountsCorrected', from: null, to: corrected },
      ],
    });

    return { date, created, corrected };
  });

  res.json(result);
}));

/* ── Content posts ────────────────────────────────────────────── */

type PostBody = Partial<ContentPost> & { reason?: string };

/** Engagements cannot exceed views.
 *
 *  Not a platform rule but an arithmetic one: it catches the common entry slip
 *  of putting a view count in a likes column, which would otherwise sit at the
 *  top of the leaderboard forever. */
function checkEngagement(post: Pick<ContentPost, 'views' | 'likes' | 'comments' | 'shares'>): void {
  if (post.likes + post.comments + post.shares > post.views) {
    throw badRequest('Engagements cannot exceed views — check the numbers.', { field: 'views' });
  }
}

growthRouter.post('/content-posts', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<PostBody>(req), CONTENT_POST_FIELDS);

  const account = await queryOne<RowDataPacket>(
    'SELECT id, platform_id FROM social_accounts WHERE id = ?', [body.accountId ?? ''],
  );
  if (!account) throw badRequest('Select the account this was posted from.', { field: 'accountId' });

  const title = body.title?.trim();
  if (!title) throw badRequest('A title is required.', { field: 'title' });

  const urlHolder = await postUrlHolder(body.url ?? '');
  if (urlHolder) throw taken('post URL', urlHolder, 'url');

  const counts = {
    views: body.views ?? 0, likes: body.likes ?? 0, comments: body.comments ?? 0, shares: body.shares ?? 0,
  };
  for (const [field, value] of Object.entries(counts)) {
    if (!Number.isInteger(value) || value < 0) {
      throw badRequest(`${field} must be a whole number of zero or more.`, { field });
    }
  }
  checkEngagement(counts);

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('CNT', conn);
    const now = nowDate();
    const values = {
      ...pick(body, CONTENT_POST_COLUMNS),
      accountId: String(account.id),
      // Denormalised from the account rather than taken from the request, so the
      // table can filter by platform without the two ever disagreeing.
      platformId: String(account.platform_id),
      format: body.format ?? 'Reel',
      title,
      url: body.url ?? '',
      publishedDate: body.publishedDate ?? today(),
      ...counts,
      metricsMeasuredAt: body.metricsMeasuredAt ?? today(),
      notes: body.notes ?? '',
      archived: false,
    };
    const insert = buildInsert('content_posts', CONTENT_POST_COLUMNS, values, {
      id, created_at: now, updated_at: now,
    });
    await execute(insert.sql, insert.params, conn);

    await recordAudit(conn, {
      actor, recordType: 'Content Post', recordId: id, recordLabel: title, action: 'create',
      reason: body.reason ?? 'Content engagement recorded',
      changes: [
        { field: 'views', from: null, to: counts.views },
        { field: 'account', from: null, to: String(account.id) },
      ],
    });
    return readContentPost(id, conn);
  });

  res.status(201).json(record);
}));

growthRouter.patch('/content-posts/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readContentPost(id);
  if (!before) throw notFound('Content post not found.');

  const { reason, ...rest } = sanitizeFields(bodyOf<PostBody>(req), CONTENT_POST_FIELDS);
  const patch = pick(rest, CONTENT_POST_COLUMNS);
  assertMayArchive(req, patch, reason);

  checkEngagement({ ...before, ...patch });

  if (patch.url !== undefined && keyChanged(postUrlKey, before.url, patch.url)) {
    const holder = await postUrlHolder(patch.url, id);
    if (holder) throw taken('post URL', holder, 'url');
  }

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('content_posts', CONTENT_POST_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Content Post', recordId: id, recordLabel: before.title,
        action: patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Content metrics updated',
        changes,
      });
    }
    return readContentPost(id, conn);
  });

  res.json(record);
}));
