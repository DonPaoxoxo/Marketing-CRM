/** Team Reports: daily, weekly and monthly work reports with files and replies.
 *
 *  Rules live in src/lib/team-reports.ts. Staff and managers see and change only
 *  their own reports; the System Administrator sees all, reviews, and may delete
 *  one permanently. Files are kept in the database and only ever sent to the
 *  report's author or the System Administrator. */

import express, { Router, type Request } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  REPORT_FILE_LIMITS, REPLY_MAX, REPORT_STATUSES, checkPeriod, checkReportContent, classifyReportFile,
  mayDeleteReport, mayEditReport, mayFileReports, mayReply, mayReview, mayViewReport, reportLabel,
  type ReportFileMeta, type ReportReply, type ReportStatus, type TeamReport,
} from '../../src/lib/team-reports';
import { sanitizeText } from '../../src/lib/sanitize';
import { execute, query, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requireAuth } from '../auth/middleware';
import { HttpError, asyncHandler, badRequest, conflict, forbidden, notFound } from '../http/errors';
import { date, isoRequired, iso, text } from '../repositories/mappers';
import { actorOf, bodyOf, nowDate } from './helpers';

/** The latest calendar date anywhere (UTC+14), so a report filed just after
 *  midnight in Manila is not refused because the server clock is still on yesterday. */
const latestToday = () => new Date(Date.now() + 14 * 3600_000).toISOString().slice(0, 10);

/** Files are written in pieces this size, well under MariaDB's smallest common
 *  max_allowed_packet (1 MB), so a 5 MB document saves on any server. */
const CHUNK_BYTES = 512 * 1024;

/** The raw upload body, with "too large" explained instead of reported as a fault. */
const readUpload = express.raw({ type: () => true, limit: REPORT_FILE_LIMITS.document + 1024 });
const uploadBody: express.RequestHandler = (req, res, next) => readUpload(req, res, (error?: unknown) => {
  if ((error as { type?: string } | undefined)?.type === 'entity.too.large') {
    return next(new HttpError(413, 'That file is too large. Images must be under 1 MB and documents up to 5 MB.', { field: 'files' }));
  }
  next(error);
});

export const teamReportsRouter = Router();
teamReportsRouter.use(requireAuth);

const REPORT_SELECT = `SELECT r.*, u.name AS author_name, rv.name AS reviewer_name
  FROM team_reports r
  JOIN users u ON u.id = r.author_id
  LEFT JOIN users rv ON rv.id = r.reviewed_by`;

async function loadReports(where: string, params: unknown[], conn?: PoolConnection): Promise<TeamReport[]> {
  const rows = await query<RowDataPacket>(`${REPORT_SELECT} WHERE ${where} ORDER BY r.period_start DESC, u.name LIMIT 1000`, params, conn);
  if (!rows.length) return [];
  const ids = rows.map((r) => String(r.id));
  const marks = ids.map(() => '?').join(',');
  const [files, replies] = await Promise.all([
    query<RowDataPacket>(`SELECT id, report_id, file_name, mime_type, size_bytes, kind, uploaded_at FROM team_report_files WHERE report_id IN (${marks}) ORDER BY uploaded_at`, ids, conn),
    query<RowDataPacket>(`SELECT * FROM team_report_replies WHERE report_id IN (${marks}) ORDER BY created_at, id`, ids, conn),
  ]);
  return rows.map((r) => ({
    id: String(r.id),
    authorId: String(r.author_id),
    authorName: text(r.author_name),
    period: r.period_type,
    periodStart: date(r.period_start)!,
    workDone: text(r.work_done),
    results: text(r.results),
    blockers: text(r.blockers),
    recommendation: text(r.recommendation),
    status: r.status as ReportStatus,
    reviewedByName: text(r.reviewer_name),
    reviewedAt: iso(r.reviewed_at),
    files: files.filter((f) => String(f.report_id) === String(r.id)).map((f): ReportFileMeta => ({
      id: String(f.id), fileName: text(f.file_name), mimeType: text(f.mime_type), sizeBytes: Number(f.size_bytes),
      kind: f.kind === 'image' ? 'image' : 'document', uploadedAt: isoRequired(f.uploaded_at),
    })),
    replies: replies.filter((x) => String(x.report_id) === String(r.id)).map((x): ReportReply => ({
      id: String(x.id), authorId: x.author_id ? String(x.author_id) : null, authorName: text(x.author_name),
      authorRole: text(x.author_role) as ReportReply['authorRole'], body: text(x.body), createdAt: isoRequired(x.created_at),
    })),
    createdAt: isoRequired(r.created_at),
    updatedAt: isoRequired(r.updated_at),
  }));
}

async function reportFor(req: Request, id: string, conn?: PoolConnection): Promise<TeamReport> {
  const [report] = await loadReports('r.id = ?', [id], conn);
  // Someone else's report is "not found", not "forbidden": its existence is not theirs to learn.
  if (!report || !mayViewReport(req.user, report)) throw notFound('Report not found.');
  return report;
}

/* ── Reading ────────────────────────────────────────────────────── */

teamReportsRouter.get('/', asyncHandler(async (req, res) => {
  const period = String(req.query.period ?? 'daily');
  const reports = mayReview(req.user)
    ? await loadReports('r.period_type = ?', [period])
    : await loadReports('r.period_type = ? AND r.author_id = ?', [period, req.user!.id]);
  res.json({ reports });
}));

teamReportsRouter.get('/files/:fileId', asyncHandler(async (req, res) => {
  const row = await queryOne<RowDataPacket>('SELECT f.*, r.author_id FROM team_report_files f JOIN team_reports r ON r.id = f.report_id WHERE f.id = ?', [String(req.params.fileId)]);
  if (!row || !mayViewReport(req.user, { authorId: String(row.author_id) })) throw notFound('File not found.');
  const chunks = await query<RowDataPacket>('SELECT data FROM team_report_file_chunks WHERE file_id = ? ORDER BY seq', [String(row.id)]);
  const data = Buffer.concat(chunks.map((c) => c.data as Buffer));
  const name = text(row.file_name);
  res.setHeader('Content-Type', text(row.mime_type));
  res.setHeader('Content-Length', String(data.length));
  // Images may show inline as thumbnails; every other file is only ever downloaded.
  const disposition = row.kind === 'image' && req.query.download === undefined ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(data);
}));

/* ── Writing ────────────────────────────────────────────────────── */

teamReportsRouter.post('/', asyncHandler(async (req, res) => {
  if (!mayFileReports(req.user)) throw forbidden(`Your role (${req.user!.role}) cannot file reports.`);
  const body = bodyOf<Record<string, unknown>>(req);
  const period = checkPeriod(body.period, body.date, latestToday());
  if ('error' in period) throw badRequest(period.error, { field: 'date' });
  const content = checkReportContent(body);
  if ('error' in content) throw badRequest(content.error, { field: content.field });

  const existing = await queryOne<RowDataPacket>(
    'SELECT id FROM team_reports WHERE author_id = ? AND period_type = ? AND period_start = ?',
    [req.user!.id, period.period, period.start],
  );
  if (existing) throw conflict('You already have a report for this period. Open it to edit.', { field: 'date', conflictId: String(existing.id) });

  const actor = actorOf(req);
  const report = await tx(async (conn) => {
    const id = await nextId('RPT', conn);
    const now = nowDate();
    await execute(
      `INSERT INTO team_reports (id, author_id, period_type, period_start, work_done, results, blockers, recommendation, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?, ?)`,
      [id, actor.id, period.period, period.start, content.value.workDone, content.value.results ?? '', content.value.blockers ?? '', content.value.recommendation ?? '', now, now],
      conn,
    );
    const [created] = await loadReports('r.id = ?', [id], conn);
    await recordAudit(conn, { actor, recordType: 'Team Report', recordId: id, recordLabel: reportLabel(created), action: 'create', reason: 'Report submitted' });
    return created;
  });
  res.status(201).json(report);
}));

teamReportsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await reportFor(req, id);
  const body = bodyOf<Record<string, unknown>>(req);
  const actor = actorOf(req);

  if (body.status !== undefined) {
    if (!mayReview(req.user)) throw forbidden('Only the System Administrator reviews reports.');
    if (!REPORT_STATUSES.includes(body.status as ReportStatus)) throw badRequest('Unknown status.', { field: 'status' });
    const status = body.status as ReportStatus;
    await tx(async (conn) => {
      await execute(
        'UPDATE team_reports SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?',
        [status, status === 'Submitted' ? null : actor.id, status === 'Submitted' ? null : nowDate(), nowDate(), id],
        conn,
      );
      await recordAudit(conn, {
        actor, recordType: 'Team Report', recordId: id, recordLabel: reportLabel(before), action: 'status-change',
        reason: `Marked ${status}`, changes: [{ field: 'status', from: before.status, to: status }],
      });
    });
  } else {
    if (!mayEditReport(req.user, before)) {
      throw forbidden(before.status === 'Reviewed' ? 'This report has been reviewed and can no longer be changed.' : 'Only the author can change a report.');
    }
    const content = checkReportContent(body, true);
    if ('error' in content) throw badRequest(content.error, { field: content.field });
    const sets = Object.entries({
      work_done: content.value.workDone, results: content.value.results, blockers: content.value.blockers, recommendation: content.value.recommendation,
    }).filter(([, v]) => v !== undefined);
    if (sets.length) {
      // A report sent back for changes goes back to Submitted once it is changed.
      await execute(
        `UPDATE team_reports SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, status = 'Submitted', updated_at = ? WHERE id = ?`,
        [...sets.map(([, v]) => v), nowDate(), id],
      );
    }
  }
  res.json(await reportFor(req, id));
}));

teamReportsRouter.post('/:id/replies', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const report = await reportFor(req, id);
  if (!mayReply(req.user, report)) throw forbidden('Only the author and the System Administrator can reply.');
  const raw = String(bodyOf<{ body?: unknown }>(req).body ?? '');
  if (raw.length > REPLY_MAX) throw badRequest(`Keep a reply under ${REPLY_MAX.toLocaleString()} characters.`, { field: 'body' });
  const message = sanitizeText(raw, REPLY_MAX);
  if (!message) throw badRequest('Write a reply first.', { field: 'body' });
  const actor = actorOf(req);
  await tx(async (conn) => {
    const replyId = await nextId('RPR', conn);
    await execute(
      'INSERT INTO team_report_replies (id, report_id, author_id, author_name, author_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [replyId, id, actor.id, actor.name, actor.role, message, nowDate()],
      conn,
    );
    await execute('UPDATE team_reports SET updated_at = ? WHERE id = ?', [nowDate(), id], conn);
  });
  res.status(201).json(await reportFor(req, id));
}));

teamReportsRouter.post(
  '/:id/files',
  uploadBody,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const report = await reportFor(req, id);
    if (!mayEditReport(req.user, report)) throw forbidden('Only the author can attach files, until the report is reviewed.');
    if (report.files.length >= REPORT_FILE_LIMITS.perReport) throw badRequest(`A report can have up to ${REPORT_FILE_LIMITS.perReport} files.`, { field: 'files' });
    const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
    const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'file'));
    const file = classifyReportFile(name, bytes);
    if ('error' in file) throw badRequest(file.error, { field: 'files' });
    await tx(async (conn) => {
      const fileId = await nextId('RPF', conn);
      await execute(
        'INSERT INTO team_report_files (id, report_id, file_name, mime_type, kind, size_bytes, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [fileId, id, file.fileName, file.mimeType, file.kind, bytes.length, nowDate()],
        conn,
      );
      for (let seq = 0, offset = 0; offset < bytes.length; seq++, offset += CHUNK_BYTES) {
        await execute(
          'INSERT INTO team_report_file_chunks (file_id, seq, data) VALUES (?, ?, ?)',
          [fileId, seq, Buffer.from(bytes.subarray(offset, offset + CHUNK_BYTES))],
          conn,
        );
      }
      await execute('UPDATE team_reports SET updated_at = ? WHERE id = ?', [nowDate(), id], conn);
    });
    res.status(201).json(await reportFor(req, id));
  }),
);

teamReportsRouter.delete('/files/:fileId', asyncHandler(async (req, res) => {
  const row = await queryOne<RowDataPacket>('SELECT report_id FROM team_report_files WHERE id = ?', [String(req.params.fileId)]);
  if (!row) throw notFound('File not found.');
  const report = await reportFor(req, String(row.report_id));
  if (!mayEditReport(req.user, report)) throw forbidden('Only the author can remove files, until the report is reviewed.');
  await execute('DELETE FROM team_report_files WHERE id = ?', [String(req.params.fileId)]);
  res.json(await reportFor(req, report.id));
}));

/** Permanent. The report, its files and replies are erased; the audit history
 *  keeps one line — who, which report, when, why — and none of its content. */
teamReportsRouter.delete('/:id', asyncHandler(async (req, res) => {
  if (!mayDeleteReport(req.user)) throw forbidden('Only the System Administrator can delete reports.');
  const id = String(req.params.id);
  const report = await reportFor(req, id);
  const reason = sanitizeText(bodyOf<{ reason?: unknown }>(req).reason, 500);
  if (!reason) throw badRequest('Deleting a report needs a written reason.', { field: 'reason' });
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('DELETE FROM team_report_replies WHERE report_id = ?', [id], conn);
    await execute('DELETE c FROM team_report_file_chunks c JOIN team_report_files f ON f.id = c.file_id WHERE f.report_id = ?', [id], conn);
    await execute('DELETE FROM team_report_files WHERE report_id = ?', [id], conn);
    await execute('DELETE FROM team_reports WHERE id = ?', [id], conn);
    await recordAudit(conn, { actor, recordType: 'Team Report', recordId: id, recordLabel: reportLabel(report), action: 'delete', reason });
  });
  res.json({ deleted: id });
}));
