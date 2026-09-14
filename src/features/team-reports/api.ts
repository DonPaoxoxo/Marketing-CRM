/** Team Reports: the calls behind the page. Every rule is checked again on the
 *  server (server/routes/team-reports.ts); what the page hides is a courtesy. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, useActorQuery, withActor } from '@/hooks/useData';
import type { ReportContent, ReportPeriod, ReportStatus, TeamReport } from '@/lib/team-reports';

export const TEAM_REPORTS_KEY = ['team-reports'] as const;

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: init.body instanceof ArrayBuffer ? init.headers : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const payload = await res.json().catch(() => ({ message: res.status === 413 ? 'That file is too large.' : res.statusText }));
  if (!res.ok) throw new ApiError(payload.message ?? 'Request failed', res.status, payload.field, payload.conflictId);
  return payload as T;
}

export const reportFileUrl = (fileId: string, download = false) =>
  `/api/team-reports/files/${encodeURIComponent(fileId)}${download ? '?download' : ''}`;

export function useTeamReports(period: ReportPeriod) {
  const actor = useActorQuery();
  return useQuery({
    queryKey: [...TEAM_REPORTS_KEY, period, actor],
    queryFn: async () => (await call<{ reports: TeamReport[] }>(withActor(`/api/team-reports?period=${period}`, actor))).reports,
  });
}

function useReportMutation<V>(run: (v: V, actor: string) => Promise<unknown>, success?: string) {
  const qc = useQueryClient();
  const actor = useActorQuery();
  return useMutation({
    mutationFn: (v: V) => run(v, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TEAM_REPORTS_KEY });
      if (success) toast.success(success);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

export const useCreateReport = () => useReportMutation<ReportContent & { period: ReportPeriod; date: string }>(
  (v, actor) => call<TeamReport>(withActor('/api/team-reports', actor), { method: 'POST', body: JSON.stringify(v) }),
  'Report submitted',
);

export const useUpdateReport = () => useReportMutation<Partial<ReportContent> & { id: string }>(
  ({ id, ...v }, actor) => call<TeamReport>(withActor(`/api/team-reports/${id}`, actor), { method: 'PATCH', body: JSON.stringify(v) }),
  'Report updated',
);

export const useSetReportStatus = () => useReportMutation<{ id: string; status: ReportStatus }>(
  ({ id, status }, actor) => call<TeamReport>(withActor(`/api/team-reports/${id}`, actor), { method: 'PATCH', body: JSON.stringify({ status }) }),
  'Status updated',
);

export const useReplyToReport = () => useReportMutation<{ id: string; body: string }>(
  ({ id, body }, actor) => call<TeamReport>(withActor(`/api/team-reports/${id}/replies`, actor), { method: 'POST', body: JSON.stringify({ body }) }),
);

export const useUploadReportFile = () => useReportMutation<{ id: string; file: File }>(
  async ({ id, file }, actor) => call<TeamReport>(withActor(`/api/team-reports/${id}/files`, actor), {
    method: 'POST',
    // The bytes themselves, which every fetch implementation sends as-is.
    body: await file.arrayBuffer(),
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  }),
);

export const useRemoveReportFile = () => useReportMutation<{ fileId: string }>(
  ({ fileId }, actor) => call<TeamReport>(withActor(`/api/team-reports/files/${fileId}`, actor), { method: 'DELETE' }),
  'File removed',
);

export const useDeleteReport = () => useReportMutation<{ id: string; reason: string }>(
  ({ id, reason }, actor) => call<{ deleted: string }>(withActor(`/api/team-reports/${id}`, actor), { method: 'DELETE', body: JSON.stringify({ reason }) }),
  'Report deleted permanently',
);
