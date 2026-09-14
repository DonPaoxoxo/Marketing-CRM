/** Proof images on agents: a post screenshot and its Post URL.
 *
 *  Upload and removal follow the agent's edit lock — only the assigned manager
 *  or the System Administrator. Viewing needs a signed-in session: images are
 *  served from the database through this route, never from a public folder. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { AgentProof } from '../../src/lib/types';
import { agentLockReason, mayEditAgent } from '../../src/lib/access';
import { checkProofImage, checkProofPostUrl, checkProofReview, decodeBase64Image, mayReviewProofs } from '../../src/lib/proofs';
import { sanitizeText } from '../../src/lib/sanitize';
import { execute, query, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requireAuth, requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../http/errors';
import { readAgent } from '../repositories/records';
import { actorOf, bodyOf, nowDate } from './helpers';

export const agentProofsRouter = Router();

const PROOF_FIELDS = 'id, agent_id, post_url, mime_type, size_bytes, uploaded_by, uploaded_by_name, verdict, verdict_reason, reviewed_by_name, reviewed_at, payment_status, paid_by_name, paid_at, archived, created_at';

export const mapProof = (r: RowDataPacket): AgentProof => ({
  id: String(r.id),
  agentId: String(r.agent_id),
  postUrl: String(r.post_url),
  mimeType: String(r.mime_type),
  sizeBytes: Number(r.size_bytes),
  uploadedById: r.uploaded_by ? String(r.uploaded_by) : null,
  uploadedByName: String(r.uploaded_by_name ?? ''),
  verdict: r.verdict === 'Accepted' || r.verdict === 'Rejected' ? r.verdict : null,
  verdictReason: String(r.verdict_reason ?? ''),
  reviewedByName: String(r.reviewed_by_name ?? ''),
  reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
  payment: r.payment_status === 'Paid' ? 'Paid' : 'Not paid',
  paidByName: String(r.paid_by_name ?? ''),
  paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
  archived: Boolean(r.archived),
  createdAt: new Date(r.created_at).toISOString(),
});

export const loadProofs = () => query<RowDataPacket>(`SELECT ${PROOF_FIELDS} FROM agent_proofs ORDER BY created_at DESC, id DESC`);

async function assertMayEdit(req: Parameters<typeof actorOf>[0], agentId: string) {
  const agent = await readAgent(agentId);
  if (!agent) throw notFound('Agent not found.');
  if (!mayEditAgent(req.user, agent)) {
    const manager = agent.managerId
      ? await queryOne<RowDataPacket>('SELECT name FROM users WHERE id = ?', [agent.managerId])
      : null;
    throw forbidden(agentLockReason(req.user, agent, manager ? String(manager.name) : 'the assigned manager') ?? 'Not allowed.');
  }
  return agent;
}

agentProofsRouter.post('/agents/:id/proofs', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const agentId = String(req.params.id);
  const agent = await assertMayEdit(req, agentId);
  if (agent.archived) throw badRequest('This agent is archived.');

  const body = bodyOf<{ postUrl?: unknown; image?: unknown }>(req);
  const url = checkProofPostUrl(body.postUrl);
  if ('error' in url) throw badRequest(url.error, { field: 'postUrl' });
  const bytes = decodeBase64Image(body.image);
  if (!bytes) throw badRequest('The image could not be read. Choose the file again.', { field: 'image' });
  const image = checkProofImage(bytes);
  if ('error' in image) throw badRequest(image.error, { field: 'image' });

  const holder = await queryOne<RowDataPacket>(
    'SELECT id, agent_id FROM agent_proofs WHERE archived = 0 AND post_url_key = ? LIMIT 1',
    [url.key],
  );
  if (holder) {
    throw conflict(`This Post URL is already on a proof for ${holder.agent_id} (${holder.id}).`, {
      field: 'postUrl', conflictId: String(holder.id),
    });
  }

  const actor = actorOf(req);
  const proof = await tx(async (conn) => {
    const id = await nextId('PRF', conn);
    const now = nowDate();
    await execute(
      `INSERT INTO agent_proofs (id, agent_id, post_url, post_url_key, mime_type, size_bytes, image, uploaded_by, uploaded_by_name, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, agentId, url.value, url.key, image.mime, bytes.length, Buffer.from(bytes), actor.id, sanitizeText(actor.name, 160), now, now],
      conn,
    );
    await recordAudit(conn, {
      actor, recordType: 'Agent', recordId: agentId, recordLabel: agent.name, action: 'update',
      reason: 'Proof uploaded',
      changes: [{ field: 'proofPostUrl', from: null, to: url.value }],
    });
    const row = await queryOne<RowDataPacket>(`SELECT ${PROOF_FIELDS} FROM agent_proofs WHERE id = ?`, [id], conn);
    return mapProof(row!);
  });

  res.status(201).json(proof);
}));

agentProofsRouter.get('/agent-proofs/:id/image', requireAuth, asyncHandler(async (req, res) => {
  const row = await queryOne<RowDataPacket>('SELECT mime_type, image FROM agent_proofs WHERE id = ?', [String(req.params.id)]);
  if (!row) throw notFound('Proof not found.');
  const image = row.image as Buffer;
  res.setHeader('Content-Type', String(row.mime_type));
  res.setHeader('Content-Length', String(image.length));
  res.setHeader('Content-Disposition', 'inline');
  // An image, never a document: nothing in it may run.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(image);
}));

agentProofsRouter.patch('/agent-proofs/:id', requirePermission('archive:records'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const row = await queryOne<RowDataPacket>(`SELECT ${PROOF_FIELDS} FROM agent_proofs WHERE id = ?`, [id]);
  if (!row) throw notFound('Proof not found.');
  const body = bodyOf<{ archived?: unknown; reason?: unknown }>(req);
  if (body.archived !== true) throw badRequest('Only removing a proof is supported.');
  const reason = sanitizeText(body.reason, 500);
  if (!reason) throw badRequest('Removing a proof needs a written reason.', { field: 'reason' });
  const agent = await assertMayEdit(req, String(row.agent_id));

  const actor = actorOf(req);
  const proof = await tx(async (conn) => {
    await execute('UPDATE agent_proofs SET archived = 1, updated_at = ? WHERE id = ?', [nowDate(), id], conn);
    await recordAudit(conn, {
      actor, recordType: 'Agent', recordId: agent.id, recordLabel: agent.name, action: 'archive', reason,
      changes: [{ field: 'proofPostUrl', from: String(row.post_url), to: null }],
    });
    const updated = await queryOne<RowDataPacket>(`SELECT ${PROOF_FIELDS} FROM agent_proofs WHERE id = ?`, [id], conn);
    return mapProof(updated!);
  });
  res.json(proof);
}));

/** Verdict (Accepted / Rejected with a reason) and payment (Paid / Not paid).
 *  System Administrator only, decided from the session role — never from input. */
agentProofsRouter.patch('/agent-proofs/:id/review', requireAuth, asyncHandler(async (req, res) => {
  if (!mayReviewProofs(req.user!.role)) throw forbidden("Only the System Administrator can set a proof's verdict or payment.");
  const id = String(req.params.id);
  const review = checkProofReview(bodyOf<{ verdict?: unknown; reason?: unknown; payment?: unknown }>(req));
  if ('error' in review) throw badRequest(review.error, { field: review.field });

  const actor = actorOf(req);
  const proof = await tx(async (conn) => {
    const row = await queryOne<RowDataPacket>(`SELECT ${PROOF_FIELDS} FROM agent_proofs WHERE id = ? FOR UPDATE`, [id], conn);
    if (!row) throw notFound('Proof not found.');
    if (row.archived) throw badRequest('This proof has been removed.');
    const before = mapProof(row);
    const agent = await readAgent(before.agentId);
    const now = nowDate();
    const name = sanitizeText(actor.name, 160);
    const changes: { field: string; from: string | null; to: string | null }[] = [];

    if (review.verdict && (review.verdict !== before.verdict || review.reason !== before.verdictReason)) {
      await execute(
        'UPDATE agent_proofs SET verdict = ?, verdict_reason = ?, reviewed_by_name = ?, reviewed_at = ?, updated_at = ? WHERE id = ?',
        [review.verdict, review.reason, name, now, now, id], conn,
      );
      changes.push({ field: 'proofVerdict', from: before.verdict, to: review.verdict });
    }
    if (review.payment && review.payment !== before.payment) {
      await execute(
        'UPDATE agent_proofs SET payment_status = ?, paid_by_name = ?, paid_at = ?, updated_at = ? WHERE id = ?',
        [review.payment, review.payment === 'Paid' ? name : '', review.payment === 'Paid' ? now : null, now, id], conn,
      );
      changes.push({ field: 'proofPayment', from: before.payment, to: review.payment });
    }
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Agent', recordId: before.agentId, recordLabel: agent?.name ?? before.agentId, action: 'status-change',
        reason: review.reason || `Proof ${id} (${before.postUrl}): ${changes.map((c) => c.to).join(', ')}`,
        changes,
      });
    }
    const updated = await queryOne<RowDataPacket>(`SELECT ${PROOF_FIELDS} FROM agent_proofs WHERE id = ?`, [id], conn);
    return mapProof(updated!);
  });
  res.json(proof);
}));
