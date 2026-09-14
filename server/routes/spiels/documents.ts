/** Spiel document references: upload, replace, review, preview and download.
 *
 *  Files are checked by extension, declared type, real content and size, stored
 *  privately in the database under a generated name, and only sent after this
 *  route has decided the caller may see that exact version. Every upload,
 *  replacement, download and review is audited. */

import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  DOCUMENT_MAX_BYTES, DOCUMENT_TRANSITIONS, FEEDBACK_MIN, LIMITS, classifyDocument, documentMetaSchema, firstIssue, isSpielOwner,
  mayDownloadVersion, mayModify, type DocumentMeta, type DocumentStatus,
} from '../../../src/lib/spiels';
import { hasPermission } from '../../../src/lib/permissions';
import { sanitizeText } from '../../../src/lib/sanitize';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { notify, notifyAdministrators } from '../../notifications';
import { extractText } from '../../ai/extract';
import { asyncHandler, badRequest, forbidden, HttpError, notFound } from '../../http/errors';
import { actorOf, bodyOf } from '../helpers';
import { documentOr404, headerText, loadDocuments, person, rawUpload, readChunks, sendFile, writeChunks } from './data';

export const documentsRouter = Router();

const LINK = (id: string) => `/shared-spiel?tab=documents&document=${encodeURIComponent(id)}`;
const TOO_LARGE = 'That file is too large. PowerPoint and PDF files can be up to 20 MB, Excel, Word and text up to 10 MB, and images up to 1 MB.';
const upload = rawUpload(DOCUMENT_MAX_BYTES + 1024, TOO_LARGE);

function readMeta(req: Request): { meta: DocumentMeta; submit: boolean } {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(headerText(req, 'x-document-meta') || '{}'); } catch { throw badRequest('The document details could not be read.'); }
  const parsed = documentMetaSchema.safeParse(raw);
  if (!parsed.success) { const i = firstIssue(parsed.error); throw badRequest(i.error, { field: i.field }); }
  return { meta: parsed.data, submit: raw.submit === true };
}

async function assertReferences(req: Request, meta: Pick<DocumentMeta, 'categoryId' | 'spielId'>, conn?: PoolConnection) {
  if (meta.categoryId) {
    const c = await queryOne<RowDataPacket>('SELECT id FROM spiel_categories WHERE id = ?', [meta.categoryId], conn);
    if (!c) throw badRequest('That category does not exist.', { field: 'categoryId' });
  }
  if (meta.spielId) {
    // Only a spiel the uploader can see — someone else's private draft does not exist for them.
    const p = person(req);
    const s = await queryOne<RowDataPacket>(
      `SELECT id FROM spiels WHERE id = ? AND deleted_at IS NULL ${isSpielOwner(p) ? '' : "AND (created_by = ? OR (approved_version_id IS NOT NULL AND status <> 'Archived'))"}`,
      isSpielOwner(p) ? [meta.spielId] : [meta.spielId, p.id], conn,
    );
    if (!s) throw badRequest('That spiel does not exist.', { field: 'spielId' });
  }
}

function checkedFile(req: Request) {
  const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
  const file = classifyDocument(headerText(req, 'x-file-name') || 'file', bytes, headerText(req, 'x-file-type') || undefined);
  if ('error' in file) throw badRequest(file.error, { field: 'file' });
  return { bytes, file };
}

async function insertVersion(conn: PoolConnection, documentId: string, no: number, req: Request, status: string) {
  const { bytes, file } = checkedFile(req);
  const id = await nextId('SPDV', conn);
  await execute(
    `INSERT INTO spiel_document_versions (id, document_id, version_no, file_name, storage_name, mime_type, kind, size_bytes, sha256, extracted_text, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, documentId, no, file.fileName, randomUUID().replace(/-/g, ''), file.mimeType, file.kind, bytes.length,
      createHash('sha256').update(bytes).digest('hex'), extractText(file.kind, file.fileName, bytes), status, req.user!.id, new Date()],
    conn,
  );
  await writeChunks(conn, id, bytes);
  return { id, file };
}

/* ── Reading ────────────────────────────────────────────────────── */

documentsRouter.get('/documents', asyncHandler(async (req, res) => {
  res.json({ documents: await loadDocuments(person(req), '1 = 1', []) });
}));

documentsRouter.get('/documents/:id', asyncHandler(async (req, res) => {
  res.json(await documentOr404(person(req), String(req.params.id), undefined, true));
}));

documentsRouter.get('/documents/:id/versions/:versionId/file', asyncHandler(async (req, res) => {
  const p = person(req);
  const docId = String(req.params.id);
  const versionId = String(req.params.versionId);
  const row = await queryOne<RowDataPacket>('SELECT id, title, created_by, status, approved_version_id FROM spiel_documents WHERE id = ? AND deleted_at IS NULL', [docId]);
  const version = row && await queryOne<RowDataPacket>('SELECT id, file_name, mime_type, kind FROM spiel_document_versions WHERE id = ? AND document_id = ?', [versionId, docId]);
  if (!row || !version || !mayDownloadVersion(p, { createdById: String(row.created_by), status: row.status, approvedVersionId: row.approved_version_id ? String(row.approved_version_id) : null }, versionId)) {
    throw notFound('File not found.');
  }
  const download = req.query.download !== undefined;
  const previewable = version.kind === 'image' || version.kind === 'pdf' || version.kind === 'text';
  const actor = actorOf(req);
  await tx((conn) => recordAudit(conn, { actor, recordType: 'Spiel Document', recordId: docId, recordLabel: String(row.title), action: 'download', reason: `${download || !previewable ? 'Downloaded' : 'Previewed'} ${version.file_name} (${versionId})` }));
  sendFile(res, await readChunks(versionId), String(version.file_name), String(version.mime_type), previewable && !download);
}));

/* ── Upload and edit ────────────────────────────────────────────── */

documentsRouter.post('/documents', upload, asyncHandler(async (req, res) => {
  if (!hasPermission(req.user, 'edit:resources')) throw forbidden(`Your role (${req.user!.role}) cannot upload documents.`);
  const { meta, submit } = readMeta(req);
  await assertReferences(req, meta);
  const actor = actorOf(req);
  const status: DocumentStatus = submit ? 'Pending Review' : 'Draft';
  const id = await tx(async (conn) => {
    const docId = await nextId('SPD', conn);
    const now = new Date();
    await execute(
      `INSERT INTO spiel_documents (id, title, category_id, spiel_id, target_country, language, description, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [docId, meta.title, meta.categoryId, meta.spielId, meta.targetCountry, meta.language, meta.description, status, actor.id, now, now],
      conn,
    );
    const version = await insertVersion(conn, docId, 1, req, status);
    await execute('UPDATE spiel_documents SET current_version_id = ? WHERE id = ?', [version.id, docId], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel Document', recordId: docId, recordLabel: meta.title, action: 'upload', reason: `Uploaded ${version.file.fileName}${submit ? ' for review' : ' as draft'}`, changes: [{ field: 'file', from: null, to: `${version.file.fileName} (${version.file.sizeBytes} bytes)` }] });
    if (submit) await notifyAdministrators(conn, actor.id, { kind: 'document-submitted', title: `Document for review: ${meta.title}`, body: `${actor.name} uploaded ${version.file.fileName}.`, link: LINK(docId), recordType: 'Spiel Document', recordId: docId });
    return docId;
  });
  res.status(201).json(await documentOr404(person(req), id, undefined, true));
}));

async function lockDocument(conn: PoolConnection, req: Request, id: string) {
  await documentOr404(person(req), id, conn);
  const [row] = await query<RowDataPacket>('SELECT * FROM spiel_documents WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id], conn);
  if (!row) throw notFound('Document not found.');
  return row;
}

documentsRouter.patch('/documents/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const body = bodyOf<Record<string, unknown>>(req);
  const parsed = documentMetaSchema.safeParse(body);
  if (!parsed.success) { const i = firstIssue(parsed.error); throw badRequest(i.error, { field: i.field }); }
  const actor = actorOf(req);
  await tx(async (conn) => {
    const row = await lockDocument(conn, req, id);
    if (!mayModify(person(req), { createdById: String(row.created_by) })) throw forbidden('Only the person who uploaded this document or the System Owner can edit it.');
    if (row.status === 'Archived') throw new HttpError(409, 'Restore this document before editing it.');
    await assertReferences(req, parsed.data, conn);
    const m = parsed.data;
    await execute('UPDATE spiel_documents SET title = ?, category_id = ?, spiel_id = ?, target_country = ?, language = ?, description = ?, updated_at = ? WHERE id = ?',
      [m.title, m.categoryId, m.spielId, m.targetCountry, m.language, m.description, new Date(), id], conn);
    const changes = (['title', 'categoryId', 'spielId', 'targetCountry', 'language', 'description'] as const)
      .map((f) => ({ field: f, from: row[{ title: 'title', categoryId: 'category_id', spielId: 'spiel_id', targetCountry: 'target_country', language: 'language', description: 'description' }[f]] ?? null, to: m[f] }))
      .filter((c) => String(c.from ?? '') !== String(c.to ?? ''));
    await recordAudit(conn, { actor, recordType: 'Spiel Document', recordId: id, recordLabel: m.title, action: 'update', reason: 'Document details updated', changes });
  });
  res.json(await documentOr404(person(req), id, undefined, true));
}));

documentsRouter.post('/documents/:id/replace', upload, asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const actor = actorOf(req);
  await tx(async (conn) => {
    const row = await lockDocument(conn, req, id);
    if (!mayModify(person(req), { createdById: String(row.created_by) })) throw forbidden('Only the person who uploaded this document or the System Owner can replace it.');
    if (row.status === 'Archived') throw new HttpError(409, 'Restore this document before replacing its file.');
    const [max] = await query<RowDataPacket>('SELECT MAX(version_no) AS n FROM spiel_document_versions WHERE document_id = ?', [id], conn);
    // A replacement is always a new version, so history is kept. Anything already approved stays usable until the new one is approved.
    const status: DocumentStatus = row.status === 'Draft' ? 'Draft' : 'Pending Review';
    const previous = String(row.current_version_id);
    const version = await insertVersion(conn, id, Number(max.n) + 1, req, status);
    if (previous !== String(row.approved_version_id)) await execute("UPDATE spiel_document_versions SET status = 'Superseded' WHERE id = ?", [previous], conn);
    await execute('UPDATE spiel_documents SET current_version_id = ?, status = ?, admin_feedback = ?, updated_at = ? WHERE id = ?', [version.id, status, '', new Date(), id], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel Document', recordId: id, recordLabel: String(row.title), action: 'upload', reason: `File replaced with ${version.file.fileName} (version ${Number(max.n) + 1})`, changes: [{ field: 'file', from: previous, to: version.file.fileName }, { field: 'status', from: row.status, to: status }] });
    if (status === 'Pending Review') {
      await notifyAdministrators(conn, actor.id, { kind: 'document-replaced', title: `Document replaced: ${row.title}`, body: `${actor.name} uploaded version ${Number(max.n) + 1} (${version.file.fileName}) for review.`, link: LINK(id), recordType: 'Spiel Document', recordId: id });
    }
  });
  res.json(await documentOr404(person(req), id, undefined, true));
}));

/* ── Workflow ───────────────────────────────────────────────────── */

documentsRouter.post('/documents/:id/actions', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const p = person(req);
  const body = bodyOf<{ action?: unknown; feedback?: unknown }>(req);
  const action = String(body.action) as keyof typeof DOCUMENT_TRANSITIONS;
  const rule = DOCUMENT_TRANSITIONS[action];
  if (!rule) throw badRequest('Unknown action.', { field: 'action' });
  const feedback = sanitizeText(body.feedback, LIMITS.feedback);
  const actor = actorOf(req);
  await tx(async (conn) => {
    const row = await lockDocument(conn, req, id);
    if (rule.ownerOnly && !isSpielOwner(p)) throw forbidden('Only the System Administrator can do that.');
    if (!rule.ownerOnly && !mayModify(p, { createdById: String(row.created_by) })) throw forbidden('Only the person who uploaded this document or the System Owner can submit it.');
    const past = { submit: 'submitted', approve: 'approved', reject: 'rejected', archive: 'archived', restore: 'restored' }[action];
    if (!rule.from.includes(row.status)) throw new HttpError(409, `A document that is ${row.status} cannot be ${past}.`);
    if (action === 'restore' && !row.approved_version_id) throw new HttpError(409, 'Only a document with an approved version can be restored.');
    if (rule.needsFeedback && feedback.length < FEEDBACK_MIN) throw badRequest(`Write an explanation of at least ${FEEDBACK_MIN} characters.`, { field: 'feedback' });
    const versionId = String(row.current_version_id);
    const now = new Date();
    const creatorId = String(row.created_by);
    const tell = async (kind: string, title: string) => {
      if (creatorId !== actor.id) await notify(conn, [creatorId], { kind, title, body: feedback ? `Feedback from ${actor.name}: ${feedback}` : `Reviewed by ${actor.name}.`, link: LINK(id), recordType: 'Spiel Document', recordId: id });
    };
    switch (action) {
      case 'submit':
        await execute("UPDATE spiel_document_versions SET status = 'Pending Review' WHERE id = ?", [versionId], conn);
        await execute("UPDATE spiel_documents SET status = 'Pending Review', updated_at = ? WHERE id = ?", [now, id], conn);
        await notifyAdministrators(conn, actor.id, { kind: row.status === 'Rejected' ? 'review-requested' : 'document-submitted', title: `Document for review: ${row.title}`, body: `${actor.name} submitted this document for review.`, link: LINK(id), recordType: 'Spiel Document', recordId: id });
        break;
      case 'approve':
        if (row.approved_version_id && String(row.approved_version_id) !== versionId) await execute("UPDATE spiel_document_versions SET status = 'Superseded' WHERE id = ?", [String(row.approved_version_id)], conn);
        await execute("UPDATE spiel_document_versions SET status = 'Approved', admin_feedback = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", [feedback, actor.id, now, versionId], conn);
        await execute("UPDATE spiel_documents SET status = 'Approved', approved_version_id = ?, approved_at = ?, admin_feedback = ?, updated_at = ? WHERE id = ?", [versionId, now, feedback, now, id], conn);
        await tell('document-approved', `Document approved: ${row.title}`);
        break;
      case 'reject':
        await execute("UPDATE spiel_document_versions SET status = 'Rejected', admin_feedback = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", [feedback, actor.id, now, versionId], conn);
        await execute("UPDATE spiel_documents SET status = 'Rejected', admin_feedback = ?, updated_at = ? WHERE id = ?", [feedback, now, id], conn);
        await tell('document-rejected', `Document rejected: ${row.title}`);
        break;
      case 'archive':
        await execute("UPDATE spiel_documents SET status = 'Archived', status_before_archive = status, updated_at = ? WHERE id = ?", [now, id], conn);
        break;
      case 'restore':
        await execute("UPDATE spiel_documents SET status = 'Approved', status_before_archive = NULL, current_version_id = approved_version_id, updated_at = ? WHERE id = ?", [now, id], conn);
        break;
    }
    const auditAction = ({ submit: 'status-change', approve: 'approve', reject: 'reject', archive: 'archive', restore: 'restore' } as const)[action];
    await recordAudit(conn, { actor, recordType: 'Spiel Document', recordId: id, recordLabel: String(row.title), action: auditAction, reason: feedback || `Document ${action === 'submit' ? 'submitted for review' : past}`, changes: [{ field: 'status', from: row.status, to: rule.to }] });
  });
  res.json(await documentOr404(p, id, undefined, true));
}));

documentsRouter.delete('/documents/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const p = person(req);
  const reason = sanitizeText(bodyOf<{ reason?: unknown }>(req).reason, 500);
  if (reason.length < FEEDBACK_MIN) throw badRequest(`Write a reason of at least ${FEEDBACK_MIN} characters.`, { field: 'reason' });
  const actor = actorOf(req);
  await tx(async (conn) => {
    const row = await lockDocument(conn, req, id);
    let mode: 'permanent' | 'soft';
    if (isSpielOwner(p)) {
      if (row.status === 'Approved') throw new HttpError(409, 'Archive the approved document before deleting it permanently.');
      mode = 'permanent';
    } else {
      if (String(row.created_by) !== p.id) throw forbidden('Only the person who uploaded this document or the System Owner can delete it.');
      if (row.approved_version_id) throw new HttpError(409, 'An approved document cannot be deleted by its uploader. Ask the System Administrator to archive it.');
      mode = 'soft';
    }
    if (mode === 'permanent') await execute('DELETE FROM spiel_documents WHERE id = ?', [id], conn);
    else await execute('UPDATE spiel_documents SET deleted_at = ?, updated_at = ? WHERE id = ?', [new Date(), new Date(), id], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel Document', recordId: id, recordLabel: String(row.title), action: 'delete', reason: `${mode === 'permanent' ? 'Permanently deleted' : 'Deleted by its uploader'}: ${reason}` });
  });
  res.json({ deleted: id });
}));
