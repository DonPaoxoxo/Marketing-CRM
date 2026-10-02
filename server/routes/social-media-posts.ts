/** Social Media Posting: a daily log of what was posted, where, by whom and
 *  why. Archiving and permanent deletion are both offered — archiving is the
 *  everyday action (edit:resources may do it via `archive:records` below,
 *  same bar as every other register); permanent deletion is for records that
 *  should never have existed, same bar as Team Reports. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { SocialMediaPost, SocialPostScreenshot } from '../../src/lib/types';
import { SOCIAL_POST_FIELDS, sanitizeFields, sanitizeText } from '../../src/lib/sanitize';
import { SOCIAL_POST_PLATFORM, SOCIAL_POST_PURPOSE } from '../../src/lib/types';
import { checkProofImage, decodeBase64Image } from '../../src/lib/proofs';
import { execute, query, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requireAuth, requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, forbidden, notFound } from '../http/errors';
import { hasPermission } from '../../src/lib/permissions';
import {
  SOCIAL_POST_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readSocialPost,
} from '../repositories/records';
import { actorOf, bodyOf, nowDate } from './helpers';

export const socialMediaPostsRouter = Router();

type PostBody = Partial<SocialMediaPost> & { reason?: string };

/* ── Screenshots ──────────────────────────────────────────────────────────
 * Kept apart from social_media_posts, the same way agent_proofs is kept
 * apart from agents: the image is never selected into the bootstrap payload,
 * only this metadata is — fetched here rather than through the generic
 * repository, exactly like loadProofs/mapProof in agent-proofs.ts. */

const SCREENSHOT_META_FIELDS = 'post_id, mime_type, size_bytes, uploaded_by, uploaded_by_name, uploaded_at';

export const mapScreenshotMeta = (r: RowDataPacket): SocialPostScreenshot => ({
  postId: String(r.post_id),
  mimeType: String(r.mime_type),
  sizeBytes: Number(r.size_bytes),
  uploadedById: r.uploaded_by ? String(r.uploaded_by) : null,
  uploadedByName: String(r.uploaded_by_name ?? ''),
  uploadedAt: new Date(r.uploaded_at).toISOString(),
});

export const loadScreenshotsMeta = () =>
  query<RowDataPacket>(`SELECT ${SCREENSHOT_META_FIELDS} FROM social_post_screenshots ORDER BY uploaded_at DESC`);

socialMediaPostsRouter.post('/:id/screenshot', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const post = await readSocialPost(id);
  if (!post) throw notFound('Post not found.');

  const bytes = decodeBase64Image(bodyOf<{ image?: unknown }>(req).image);
  if (!bytes) throw badRequest('The image could not be read. Choose the file again.', { field: 'image' });
  const checked = checkProofImage(bytes);
  if ('error' in checked) throw badRequest(checked.error, { field: 'image' });

  const actor = actorOf(req);
  const meta = await tx(async (conn) => {
    const now = nowDate();
    // Replace rather than merge: one screenshot per post, so a new upload
    // simply takes over the row.
    await execute('DELETE FROM social_post_screenshots WHERE post_id = ?', [id], conn);
    await execute(
      `INSERT INTO social_post_screenshots (post_id, mime_type, size_bytes, image, uploaded_by, uploaded_by_name, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, checked.mime, bytes.length, Buffer.from(bytes), actor.id, sanitizeText(actor.name, 160), now],
      conn,
    );
    await recordAudit(conn, {
      actor, recordType: 'Social Media Post', recordId: id, recordLabel: `${id} — ${post.platform}`, action: 'update',
      reason: 'Screenshot uploaded',
      changes: [{ field: 'screenshot', from: null, to: '[uploaded]' }],
    });
    const row = await queryOne<RowDataPacket>(`SELECT ${SCREENSHOT_META_FIELDS} FROM social_post_screenshots WHERE post_id = ?`, [id], conn);
    return mapScreenshotMeta(row!);
  });

  res.status(201).json(meta);
}));

socialMediaPostsRouter.get('/:id/screenshot', requireAuth, asyncHandler(async (req, res) => {
  const row = await queryOne<RowDataPacket>('SELECT mime_type, image FROM social_post_screenshots WHERE post_id = ?', [String(req.params.id)]);
  if (!row) throw notFound('No screenshot for this post.');
  const image = row.image as Buffer;
  res.setHeader('Content-Type', String(row.mime_type));
  res.setHeader('Content-Length', String(image.length));
  res.setHeader('Content-Disposition', 'inline');
  // An image, never a document: nothing in it may run.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(image);
}));

socialMediaPostsRouter.delete('/:id/screenshot', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const post = await readSocialPost(id);
  if (!post) throw notFound('Post not found.');

  const actor = actorOf(req);
  await tx(async (conn) => {
    const removed = await execute('DELETE FROM social_post_screenshots WHERE post_id = ?', [id], conn);
    if (removed.affectedRows === 0) throw notFound('No screenshot for this post.');
    await recordAudit(conn, {
      actor, recordType: 'Social Media Post', recordId: id, recordLabel: `${id} — ${post.platform}`, action: 'update',
      reason: 'Screenshot removed',
      changes: [{ field: 'screenshot', from: '[uploaded]', to: null }],
    });
  });

  res.json({ removed: id });
}));

/** Purpose/platform plus their matching custom text, the same rule in both
 *  directions: "Others" needs the custom field written in; anything else
 *  carries no leftover custom text.
 *
 *  Only runs when the request actually touches one of these four fields — an
 *  archive/restore patch carries just `status` and a reason, and must not be
 *  forced through purpose/platform validation it has nothing to do with. */
function applyPurposeAndPlatform(body: PostBody, before?: SocialMediaPost): { field: string; message: string } | null {
  if (body.purpose !== undefined || body.customPurpose !== undefined) {
    const purpose = body.purpose ?? before?.purpose;
    if (!purpose || !SOCIAL_POST_PURPOSE.includes(purpose)) return { field: 'purpose', message: 'Select a valid purpose.' };
    const customPurpose = (body.purpose !== undefined ? body.customPurpose ?? '' : body.customPurpose ?? before?.customPurpose ?? '').trim();
    if (purpose === 'Others' && !customPurpose) return { field: 'customPurpose', message: 'Write the custom purpose.' };
    body.purpose = purpose;
    body.customPurpose = purpose === 'Others' ? customPurpose : '';
  }

  if (body.platform !== undefined || body.customPlatform !== undefined) {
    const platform = body.platform ?? before?.platform;
    if (!platform || !SOCIAL_POST_PLATFORM.includes(platform)) return { field: 'platform', message: 'Select a valid platform.' };
    const customPlatform = (body.platform !== undefined ? body.customPlatform ?? '' : body.customPlatform ?? before?.customPlatform ?? '').trim();
    if (platform === 'Others' && !customPlatform) return { field: 'customPlatform', message: 'Write the custom platform.' };
    body.platform = platform;
    body.customPlatform = platform === 'Others' ? customPlatform : '';
  }
  return null;
}

socialMediaPostsRouter.post('/', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<PostBody>(req), SOCIAL_POST_FIELDS);
  if (!body.marketingMemberId) throw badRequest('Select who posted this.', { field: 'marketingMemberId' });
  if (!body.purpose) throw badRequest('Select a purpose.', { field: 'purpose' });
  if (!body.platform) throw badRequest('Select a platform.', { field: 'platform' });
  if (!body.postDate) throw badRequest('A date is required.', { field: 'postDate' });
  const postLink = body.postLink?.trim() ?? '';
  if (!postLink) throw badRequest('A post link is required.', { field: 'postLink' });

  const problem = applyPurposeAndPlatform(body);
  if (problem) throw badRequest(problem.message, { field: problem.field });

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('SMP', conn);
    const now = nowDate();
    const values = {
      ...pick(body, SOCIAL_POST_COLUMNS),
      postLink,
      notes: body.notes ?? '',
      status: 'active',
    };
    const insert = buildInsert('social_media_posts', SOCIAL_POST_COLUMNS, values, {
      id, created_by: actor.id, created_at: now, updated_at: now,
    });
    await execute(insert.sql, insert.params, conn);

    await recordAudit(conn, {
      actor, recordType: 'Social Media Post', recordId: id, recordLabel: `${id} — ${body.platform}`, action: 'create',
      reason: body.reason ?? 'Post logged',
      changes: [{ field: 'postLink', from: null, to: postLink }],
    });
    return readSocialPost(id, conn);
  });

  res.status(201).json(record);
}));

socialMediaPostsRouter.patch('/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readSocialPost(id);
  if (!before) throw notFound('Post not found.');

  const body = sanitizeFields(bodyOf<PostBody>(req), SOCIAL_POST_FIELDS);
  if (body.postLink !== undefined) {
    body.postLink = body.postLink.trim();
    if (!body.postLink) throw badRequest('A post link is required.', { field: 'postLink' });
  }
  const problem = applyPurposeAndPlatform(body, before);
  if (problem) throw badRequest(problem.message, { field: problem.field });

  // Archiving/restoring is a status change, gated the same way every other
  // register gates archiving — a higher bar than an ordinary edit, with a reason.
  const changingStatus = body.status !== undefined && body.status !== before.status;
  if (changingStatus) {
    if (!hasPermission(req.user, 'archive:records')) {
      throw forbidden(`Your role (${req.user!.role}) cannot ${body.status === 'archived' ? 'archive' : 'restore'} records.`);
    }
    if (!body.reason?.trim()) throw badRequest(`${body.status === 'archived' ? 'Archiving' : 'Restoring'} needs a written reason.`, { field: 'reason' });
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, SOCIAL_POST_COLUMNS);
  if (changingStatus) {
    patch.archivedAt = body.status === 'archived' ? nowDate().toISOString() : null;
    patch.archivedById = body.status === 'archived' ? req.user!.id : null;
  }

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('social_media_posts', SOCIAL_POST_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Social Media Post', recordId: id, recordLabel: `${id} — ${before.platform}`,
        action: changingStatus ? (body.status === 'archived' ? 'archive' : 'restore') : 'update',
        reason: reason ?? 'Post updated',
        changes,
      });
    }
    return readSocialPost(id, conn);
  });

  res.json(record);
}));

/** Permanent. For a record that should never have existed — use archiving for
 *  everyday cleanup instead. */
socialMediaPostsRouter.delete('/:id', requirePermission('archive:records'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readSocialPost(id);
  if (!before) throw notFound('Post not found.');
  const reason = (bodyOf<{ reason?: string }>(req).reason ?? '').trim();
  if (!reason) throw badRequest('Deleting a post needs a written reason.', { field: 'reason' });

  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('DELETE FROM social_media_posts WHERE id = ?', [id], conn);
    await recordAudit(conn, {
      actor, recordType: 'Social Media Post', recordId: id, recordLabel: `${id} — ${before.platform}`, action: 'delete', reason,
    });
  });

  res.json({ deleted: id });
}));
