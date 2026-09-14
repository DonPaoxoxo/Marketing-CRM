/** Reading Shared Spiel Library records.
 *
 *  Visibility is enforced in the SQL itself, not only after loading: a member's
 *  queries can only ever return their own records plus approved, live ones. Other
 *  members' private drafts never leave the database for them. */

import express, { type Request, type Response } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  isOutdated, isSpielOwner, mayModify, maySeeWorkingVersion,
  type DocumentVersion, type SpielApproval, type SpielCategory, type SpielComment, type SpielDetail, type SpielDocument,
  type Spiel, type SpielPerson, type SpielVersion,
} from '../../../src/lib/spiels';
import { execute, query } from '../../db/pool';
import { HttpError, notFound } from '../../http/errors';
import { iso, isoRequired, text } from '../../repositories/mappers';

export const person = (req: Request): SpielPerson => ({ id: req.user!.id, role: req.user!.role });

/* ── Categories ─────────────────────────────────────────────────── */

export async function loadCategories(conn?: PoolConnection): Promise<SpielCategory[]> {
  const rows = await query<RowDataPacket>('SELECT * FROM spiel_categories ORDER BY sort_order, name', [], conn);
  return rows.map((r) => ({ id: String(r.id), name: text(r.name), sortOrder: Number(r.sort_order), active: Boolean(r.active) }));
}

/* ── Spiels ─────────────────────────────────────────────────────── */

const VERSION_SELECT = `SELECT v.*, c.name AS category_name, cu.name AS creator_name, uu.name AS updater_name, ru.name AS reviewer_name
  FROM spiel_versions v
  JOIN spiel_categories c ON c.id = v.category_id
  JOIN users cu ON cu.id = v.created_by
  LEFT JOIN users uu ON uu.id = v.updated_by
  LEFT JOIN users ru ON ru.id = v.reviewed_by`;

export const mapVersion = (r: RowDataPacket): SpielVersion => ({
  id: String(r.id),
  versionNo: Number(r.version_no),
  title: text(r.title),
  categoryId: String(r.category_id),
  categoryName: text(r.category_name),
  content: text(r.content),
  situation: text(r.situation),
  targetCountry: r.target_country,
  language: text(r.language),
  platform: r.platform,
  campaignRef: text(r.campaign_ref),
  tags: text(r.tags).split(',').filter(Boolean),
  status: r.status,
  adminFeedback: text(r.admin_feedback),
  createdById: String(r.created_by),
  createdByName: text(r.creator_name),
  createdAt: isoRequired(r.created_at),
  updatedByName: text(r.updater_name),
  updatedAt: isoRequired(r.updated_at),
  submittedAt: iso(r.submitted_at),
  reviewedByName: text(r.reviewer_name),
  reviewedAt: iso(r.reviewed_at),
});

/** Rows a person may see. `alias` is the spiels table alias. */
export function visibleSpielsWhere(p: SpielPerson, alias = 's'): { sql: string; params: unknown[] } {
  if (isSpielOwner(p)) return { sql: `${alias}.deleted_at IS NULL`, params: [] };
  return {
    sql: `${alias}.deleted_at IS NULL AND (${alias}.created_by = ? OR (${alias}.approved_version_id IS NOT NULL AND ${alias}.status <> 'Archived'))`,
    params: [p.id],
  };
}

export async function loadSpiels(p: SpielPerson, where: string, params: unknown[], conn?: PoolConnection): Promise<Spiel[]> {
  const visible = visibleSpielsWhere(p);
  const rows = await query<RowDataPacket>(
    `SELECT s.*, cu.name AS creator_name, au.name AS approver_name,
            (SELECT COUNT(*) FROM spiel_favorites f WHERE f.spiel_id = s.id) AS favorite_count
       FROM spiels s JOIN users cu ON cu.id = s.created_by LEFT JOIN users au ON au.id = s.approved_by
      WHERE ${visible.sql} AND (${where})
      ORDER BY s.updated_at DESC LIMIT 2000`,
    [...visible.params, ...params],
    conn,
  );
  if (!rows.length) return [];
  const versionIds = [...new Set(rows.flatMap((r) => [r.current_version_id, r.approved_version_id]).filter(Boolean).map(String))];
  const spielIds = rows.map((r) => String(r.id));
  const marks = (n: number) => Array(n).fill('?').join(',');
  const [versions, favorites, notes] = await Promise.all([
    query<RowDataPacket>(`${VERSION_SELECT} WHERE v.id IN (${marks(versionIds.length)})`, versionIds, conn),
    query<RowDataPacket>(`SELECT spiel_id FROM spiel_favorites WHERE user_id = ? AND spiel_id IN (${marks(spielIds.length)})`, [p.id, ...spielIds], conn),
    query<RowDataPacket>(`SELECT spiel_id, body FROM spiel_notes WHERE user_id = ? AND spiel_id IN (${marks(spielIds.length)})`, [p.id, ...spielIds], conn),
  ]);
  const byId = new Map(versions.map((v) => [String(v.id), mapVersion(v)]));
  const favored = new Set(favorites.map((f) => String(f.spiel_id)));
  const noteBy = new Map(notes.map((n) => [String(n.spiel_id), text(n.body)]));

  return rows.map((r) => {
    const createdById = String(r.created_by);
    const approved = r.approved_version_id ? byId.get(String(r.approved_version_id)) ?? null : null;
    const working = byId.get(String(r.current_version_id))!;
    const seesWorking = maySeeWorkingVersion(p, { createdById });
    return {
      id: String(r.id),
      // Someone who may only see the approved version sees it as Approved, not as the pending edit.
      status: seesWorking ? r.status : 'Approved',
      approved,
      current: seesWorking ? working : approved!,
      approvedByName: text(r.approver_name),
      approvedAt: iso(r.approved_at),
      usageCount: Number(r.usage_count),
      lastUsedAt: iso(r.last_used_at),
      createdById,
      createdByName: text(r.creator_name),
      createdAt: isoRequired(r.created_at),
      updatedAt: isoRequired(r.updated_at),
      favorite: favored.has(String(r.id)),
      note: noteBy.get(String(r.id)) ?? '',
      favoriteCount: Number(r.favorite_count),
      canEdit: mayModify(p, { createdById }),
    } satisfies Spiel;
  });
}

/** The spiel if this person may see it, otherwise 404 — never 403, so ids cannot be probed. */
export async function spielOr404(p: SpielPerson, id: string, conn?: PoolConnection): Promise<Spiel> {
  const [spiel] = await loadSpiels(p, 's.id = ?', [id], conn);
  if (!spiel) throw notFound('Spiel not found.');
  return spiel;
}

/** The raw row, locked for update, after the caller has passed spielOr404. */
export async function lockSpiel(conn: PoolConnection, id: string): Promise<RowDataPacket> {
  const [row] = await query<RowDataPacket>('SELECT * FROM spiels WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [id], conn);
  if (!row) throw notFound('Spiel not found.');
  return row;
}

export async function loadSpielDetail(p: SpielPerson, id: string, conn?: PoolConnection): Promise<SpielDetail> {
  const spiel = await spielOr404(p, id, conn);
  const full = maySeeWorkingVersion(p, spiel);
  const [versions, approvals, comments, documents] = await Promise.all([
    query<RowDataPacket>(`${VERSION_SELECT} WHERE v.spiel_id = ? ${full ? '' : "AND v.status IN ('Approved', 'Superseded')"} ORDER BY v.version_no DESC`, [id], conn),
    query<RowDataPacket>(
      `SELECT a.*, v.version_no FROM spiel_approvals a LEFT JOIN spiel_versions v ON v.id = a.version_id
        WHERE a.spiel_id = ? ${full ? '' : "AND a.action IN ('approved', 'archived', 'restored')"} ORDER BY a.created_at DESC, a.id DESC`,
      [id], conn,
    ),
    query<RowDataPacket>('SELECT c.*, u.name AS creator_name FROM spiel_comments c JOIN users u ON u.id = c.created_by WHERE c.spiel_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at', [id], conn),
    loadDocuments(p, 'd.spiel_id = ?', [id], conn),
  ]);
  return {
    ...spiel,
    versions: versions.map(mapVersion),
    approvals: approvals.map((a): SpielApproval => ({
      id: String(a.id), versionNo: a.version_no === null ? null : Number(a.version_no), action: a.action,
      // Private review feedback belongs to the author and the System Owner.
      feedback: full || a.action === 'approved' ? text(a.feedback) : '',
      changes: full ? text(a.changes) : '', actorName: text(a.actor_name), createdAt: isoRequired(a.created_at),
    })),
    comments: comments.map((c): SpielComment => ({
      id: String(c.id), body: text(c.body), createdById: String(c.created_by), createdByName: text(c.creator_name),
      createdAt: isoRequired(c.created_at), updatedAt: isoRequired(c.updated_at), canEdit: mayModify(p, { createdById: String(c.created_by) }),
    })),
    documents,
  };
}

/* ── Documents ──────────────────────────────────────────────────── */

const mapDocVersion = (r: RowDataPacket): DocumentVersion => ({
  id: String(r.id), versionNo: Number(r.version_no), fileName: text(r.file_name), mimeType: text(r.mime_type), kind: r.kind,
  sizeBytes: Number(r.size_bytes), status: r.status, adminFeedback: text(r.admin_feedback), createdByName: text(r.creator_name),
  createdAt: isoRequired(r.created_at), reviewedByName: text(r.reviewer_name), reviewedAt: iso(r.reviewed_at), hasText: Boolean(r.has_text),
});

const DOC_VERSION_SELECT = `SELECT dv.id, dv.document_id, dv.version_no, dv.file_name, dv.mime_type, dv.kind, dv.size_bytes, dv.status, dv.admin_feedback,
    dv.created_at, dv.reviewed_at, (dv.extracted_text IS NOT NULL AND dv.extracted_text <> '') AS has_text, cu.name AS creator_name, ru.name AS reviewer_name
  FROM spiel_document_versions dv JOIN users cu ON cu.id = dv.created_by LEFT JOIN users ru ON ru.id = dv.reviewed_by`;

export function visibleDocumentsWhere(p: SpielPerson, alias = 'd'): { sql: string; params: unknown[] } {
  if (isSpielOwner(p)) return { sql: `${alias}.deleted_at IS NULL`, params: [] };
  return {
    sql: `${alias}.deleted_at IS NULL AND (${alias}.created_by = ? OR (${alias}.approved_version_id IS NOT NULL AND ${alias}.status <> 'Archived'))`,
    params: [p.id],
  };
}

export async function loadDocuments(p: SpielPerson, where: string, params: unknown[], conn?: PoolConnection, withVersions = false): Promise<SpielDocument[]> {
  const visible = visibleDocumentsWhere(p);
  const rows = await query<RowDataPacket>(
    `SELECT d.*, c.name AS category_name, u.name AS creator_name
       FROM spiel_documents d LEFT JOIN spiel_categories c ON c.id = d.category_id JOIN users u ON u.id = d.created_by
      WHERE ${visible.sql} AND (${where}) ORDER BY d.updated_at DESC LIMIT 2000`,
    [...visible.params, ...params],
    conn,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const versions = await query<RowDataPacket>(`${DOC_VERSION_SELECT} WHERE dv.document_id IN (${ids.map(() => '?').join(',')}) ORDER BY dv.version_no DESC`, ids, conn);
  return rows.map((r) => {
    const createdById = String(r.created_by);
    const mine = versions.filter((v) => String(v.document_id) === String(r.id)).map(mapDocVersion);
    const approved = mine.find((v) => v.id === String(r.approved_version_id)) ?? null;
    const working = mine.find((v) => v.id === String(r.current_version_id)) ?? mine[0];
    const full = mayModify(p, { createdById });
    return {
      id: String(r.id), title: text(r.title), categoryId: r.category_id ? String(r.category_id) : null, categoryName: text(r.category_name),
      spielId: r.spiel_id ? String(r.spiel_id) : null, targetCountry: r.target_country, language: text(r.language), description: text(r.description),
      status: full ? r.status : 'Approved', adminFeedback: full ? text(r.admin_feedback) : '',
      current: full ? working : approved!, approved, approvedAt: iso(r.approved_at),
      createdById, createdByName: text(r.creator_name), createdAt: isoRequired(r.created_at), updatedAt: isoRequired(r.updated_at),
      outdated: isOutdated(iso(r.approved_at)), canEdit: full,
      versions: withVersions ? (full ? mine : mine.filter((v) => v.id === approved?.id)) : undefined,
    } satisfies SpielDocument;
  });
}

export async function documentOr404(p: SpielPerson, id: string, conn?: PoolConnection, withVersions = false): Promise<SpielDocument> {
  const [doc] = await loadDocuments(p, 'd.id = ?', [id], conn, withVersions);
  if (!doc) throw notFound('Document not found.');
  return doc;
}

/* ── Files ──────────────────────────────────────────────────────── */

const CHUNK_BYTES = 512 * 1024;

export async function writeChunks(conn: PoolConnection, fileId: string, bytes: Uint8Array): Promise<void> {
  for (let seq = 0, offset = 0; offset < bytes.length; seq++, offset += CHUNK_BYTES) {
    await execute('INSERT INTO spiel_file_chunks (file_id, seq, data) VALUES (?, ?, ?)', [fileId, seq, Buffer.from(bytes.subarray(offset, offset + CHUNK_BYTES))], conn);
  }
}

export async function readChunks(fileId: string): Promise<Buffer> {
  const rows = await query<RowDataPacket>('SELECT data FROM spiel_file_chunks WHERE file_id = ? ORDER BY seq', [fileId]);
  return Buffer.concat(rows.map((r) => r.data as Buffer));
}

export function sendFile(res: Response, data: Buffer, name: string, mime: string, inline: boolean) {
  const previewMime = inline && mime.startsWith('text/') ? 'text/plain; charset=utf-8' : mime;
  res.setHeader('Content-Type', previewMime);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  // Nothing in a stored file may ever run in this origin.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(data);
}

/** A raw file body with "too large" explained instead of reported as a fault. */
export function rawUpload(limitBytes: number, message: string): express.RequestHandler {
  const read = express.raw({ type: () => true, limit: limitBytes });
  return (req, res, next) => read(req, res, (error?: unknown) => {
    if ((error as { type?: string } | undefined)?.type === 'entity.too.large') return next(new HttpError(413, message, { field: 'file' }));
    next(error);
  });
}

export function headerText(req: Request, name: string): string {
  const raw = req.headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return '';
  try { return decodeURIComponent(value); } catch { return ''; }
}
