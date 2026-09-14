/** Team Reports in the mock API — mirrors server/routes/team-reports.ts, with
 *  reports and file bytes kept in memory only. */

import { HttpResponse, http } from 'msw';
import type { TeamMember } from '@/lib/types';
import { sanitizeText } from '@/lib/sanitize';
import {
  REPLY_MAX, REPORT_FILE_LIMITS, REPORT_STATUSES, checkPeriod, checkReportContent, classifyReportFile,
  mayDeleteReport, mayEditReport, mayFileReports, mayReply, mayReview, mayViewReport, reportLabel,
  type ReportStatus, type TeamReport,
} from '@/lib/team-reports';
import { nextId, recordAudit } from './db';

export interface TeamReportStore {
  reports: TeamReport[];
  files: Record<string, Uint8Array>;
}

export const teamReportStore: TeamReportStore = { reports: [], files: {} };
export function resetTeamReports() {
  teamReportStore.reports = [];
  teamReportStore.files = {};
}

const bad = (message: string, status = 400, extra: Record<string, unknown> = {}) => HttpResponse.json({ message, ...extra }, { status });
const now = () => new Date().toISOString();
const latestToday = () => new Date(Date.now() + 14 * 3600_000).toISOString().slice(0, 10);

export function teamReportHandlers(api: string, actor: (req: Request) => TeamMember) {
  const find = (req: Request, id: string) => {
    const report = teamReportStore.reports.find((r) => r.id === id);
    return report && mayViewReport(actor(req), report) ? report : undefined;
  };
  const audit = (entry: Omit<Parameters<typeof recordAudit>[0], 'changes'> & { changes?: Parameters<typeof recordAudit>[0]['changes'] }) =>
    recordAudit({ ...entry, changes: entry.changes ?? [] });

  return [
    http.get(`${api}/team-reports`, ({ request }) => {
      const who = actor(request);
      const period = new URL(request.url).searchParams.get('period') ?? 'daily';
      const reports = teamReportStore.reports
        .filter((r) => r.period === period && (mayReview(who) || r.authorId === who.id))
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart) || a.authorName.localeCompare(b.authorName));
      return HttpResponse.json({ reports });
    }),

    http.get(`${api}/team-reports/files/:fileId`, ({ request, params }) => {
      const report = teamReportStore.reports.find((r) => r.files.some((f) => f.id === params.fileId));
      const file = report?.files.find((f) => f.id === params.fileId);
      if (!report || !file || !mayViewReport(actor(request), report)) return bad('File not found.', 404);
      return new HttpResponse(teamReportStore.files[file.id], { headers: { 'Content-Type': file.mimeType } });
    }),

    http.post(`${api}/team-reports`, async ({ request }) => {
      const who = actor(request);
      if (!mayFileReports(who)) return bad(`Your role (${who.role}) cannot file reports.`, 403);
      const body = (await request.json()) as Record<string, unknown>;
      const period = checkPeriod(body.period, body.date, latestToday());
      if ('error' in period) return bad(period.error, 400, { field: 'date' });
      const content = checkReportContent(body);
      if ('error' in content) return bad(content.error, 400, { field: content.field });
      const existing = teamReportStore.reports.find((r) => r.authorId === who.id && r.period === period.period && r.periodStart === period.start);
      if (existing) return bad('You already have a report for this period. Open it to edit.', 409, { field: 'date', conflictId: existing.id });
      const report: TeamReport = {
        id: nextId('RPT', teamReportStore.reports), authorId: who.id, authorName: who.name, period: period.period, periodStart: period.start,
        workDone: content.value.workDone ?? '', results: content.value.results ?? '', blockers: content.value.blockers ?? '',
        recommendation: content.value.recommendation ?? '', status: 'Submitted', reviewedByName: '', reviewedAt: null,
        files: [], replies: [], createdAt: now(), updatedAt: now(),
      };
      teamReportStore.reports.push(report);
      audit({ actor: who, recordType: 'Team Report', recordId: report.id, recordLabel: reportLabel(report), action: 'create', reason: 'Report submitted' });
      return HttpResponse.json(report, { status: 201 });
    }),

    http.patch(`${api}/team-reports/:id`, async ({ request, params }) => {
      const who = actor(request);
      const report = find(request, String(params.id));
      if (!report) return bad('Report not found.', 404);
      const body = (await request.json()) as Record<string, unknown>;
      if (body.status !== undefined) {
        if (!mayReview(who)) return bad('Only the System Administrator reviews reports.', 403);
        if (!REPORT_STATUSES.includes(body.status as ReportStatus)) return bad('Unknown status.', 400, { field: 'status' });
        const from = report.status;
        report.status = body.status as ReportStatus;
        report.reviewedByName = report.status === 'Submitted' ? '' : who.name;
        report.reviewedAt = report.status === 'Submitted' ? null : now();
        audit({ actor: who, recordType: 'Team Report', recordId: report.id, recordLabel: reportLabel(report), action: 'status-change', reason: `Marked ${report.status}`, changes: [{ field: 'status', from, to: report.status }] });
      } else {
        if (!mayEditReport(who, report)) {
          return bad(report.status === 'Reviewed' ? 'This report has been reviewed and can no longer be changed.' : 'Only the author can change a report.', 403);
        }
        const content = checkReportContent(body, true);
        if ('error' in content) return bad(content.error, 400, { field: content.field });
        if (Object.keys(content.value).length) Object.assign(report, content.value, { status: 'Submitted' });
      }
      report.updatedAt = now();
      return HttpResponse.json(report);
    }),

    http.post(`${api}/team-reports/:id/replies`, async ({ request, params }) => {
      const who = actor(request);
      const report = find(request, String(params.id));
      if (!report) return bad('Report not found.', 404);
      if (!mayReply(who, report)) return bad('Only the author and the System Administrator can reply.', 403);
      const raw = String(((await request.json()) as { body?: unknown }).body ?? '');
      if (raw.length > REPLY_MAX) return bad(`Keep a reply under ${REPLY_MAX.toLocaleString()} characters.`, 400, { field: 'body' });
      const text = sanitizeText(raw, REPLY_MAX);
      if (!text) return bad('Write a reply first.', 400, { field: 'body' });
      report.replies.push({ id: nextId('RPR', teamReportStore.reports.flatMap((r) => r.replies)), authorId: who.id, authorName: who.name, authorRole: who.role, body: text, createdAt: now() });
      report.updatedAt = now();
      return HttpResponse.json(report, { status: 201 });
    }),

    http.post(`${api}/team-reports/:id/files`, async ({ request, params }) => {
      const who = actor(request);
      const report = find(request, String(params.id));
      if (!report) return bad('Report not found.', 404);
      if (!mayEditReport(who, report)) return bad('Only the author can attach files, until the report is reviewed.', 403);
      if (report.files.length >= REPORT_FILE_LIMITS.perReport) return bad(`A report can have up to ${REPORT_FILE_LIMITS.perReport} files.`, 400, { field: 'files' });
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > REPORT_FILE_LIMITS.document + 1024) return bad('File too large.', 413, { field: 'files' });
      const file = classifyReportFile(decodeURIComponent(request.headers.get('x-file-name') ?? 'file'), bytes);
      if ('error' in file) return bad(file.error, 400, { field: 'files' });
      const id = nextId('RPF', teamReportStore.reports.flatMap((r) => r.files));
      teamReportStore.files[id] = bytes;
      report.files.push({ id, fileName: file.fileName, mimeType: file.mimeType, kind: file.kind, sizeBytes: bytes.length, uploadedAt: now() });
      report.updatedAt = now();
      return HttpResponse.json(report, { status: 201 });
    }),

    http.delete(`${api}/team-reports/files/:fileId`, ({ request, params }) => {
      const who = actor(request);
      const report = teamReportStore.reports.find((r) => r.files.some((f) => f.id === params.fileId));
      if (!report || !mayViewReport(who, report)) return bad('File not found.', 404);
      if (!mayEditReport(who, report)) return bad('Only the author can remove files, until the report is reviewed.', 403);
      report.files = report.files.filter((f) => f.id !== params.fileId);
      delete teamReportStore.files[String(params.fileId)];
      return HttpResponse.json(report);
    }),

    http.delete(`${api}/team-reports/:id`, async ({ request, params }) => {
      const who = actor(request);
      if (!mayDeleteReport(who)) return bad('Only the System Administrator can delete reports.', 403);
      const report = find(request, String(params.id));
      if (!report) return bad('Report not found.', 404);
      const reason = sanitizeText(((await request.json().catch(() => ({}))) as { reason?: unknown }).reason, 500);
      if (!reason) return bad('Deleting a report needs a written reason.', 400, { field: 'reason' });
      report.files.forEach((f) => { delete teamReportStore.files[f.id]; });
      teamReportStore.reports = teamReportStore.reports.filter((r) => r.id !== report.id);
      audit({ actor: who, recordType: 'Team Report', recordId: report.id, recordLabel: reportLabel(report), action: 'delete', reason });
      return HttpResponse.json({ deleted: report.id });
    }),
  ];
}
