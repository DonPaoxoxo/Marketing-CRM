/** Ads Monitoring: the calls behind the pages. The server re-checks every rule;
 *  hiding a button here is a courtesy, not the permission. */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/hooks/useData';
import type { AlertSettings, Campaign, CampaignAlert, Pacing, StatusChange } from '@/lib/ads/campaign';
import type { DailyRecord } from '@/lib/ads/metrics';
import type { TrendResult } from '@/lib/ads/trends';
import type { AnalysedRow } from '@/lib/ads/import';

export const ADS_KEY = ['ads'] as const;

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const binary = init.body instanceof ArrayBuffer;
  const res = await fetch(`/api/ads${url}`, {
    ...init,
    credentials: 'same-origin',
    headers: binary ? init.headers : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const payload = await res.json().catch(() => ({ message: res.status === 413 ? 'That file is too large.' : res.statusText }));
  if (!res.ok) throw new ApiError(payload.message ?? 'Request failed', res.status, payload.field, payload.conflictId);
  return payload as T;
}

export const creativeUrl = (id: string, download = false) => `/api/ads/creatives/${encodeURIComponent(id)}/file${download ? '?download' : ''}`;
export const referenceUrl = (id: string, download = false) => `/api/ads/references/${encodeURIComponent(id)}/file${download ? '?download' : ''}`;

/* ── Types returned by the API ─────────────────────────────────── */

export interface CreativeSummary { id: string; fileName: string; adsUrl: string; width: number; height: number; sizeBytes: number; createdByName: string; createdAt: string }
export interface CampaignRow extends Campaign {
  spend: string | null;
  recordCount: number;
  primaryResult: { label: string; value: number | null; costLabel: string; cost: number | null };
  trend: { metric: string } & (TrendResult | { status: 'insufficient'; reason: string });
  creatives: CreativeSummary[];
  canEdit: boolean;
}
export interface SavedRecord extends DailyRecord { id: string; campaignId: string; notes: string; createdById: string; createdByName: string; createdAt: string; updatedAt: string; canEdit: boolean }
export interface Creative extends CreativeSummary { campaignId: string; usedFrom: string | null; usedTo: string | null; description: string; createdById: string; canEdit: boolean }
export interface Reference { id: string; campaignId: string; dailyRecordId: string | null; fileName: string; mimeType: string; kind: string; sizeBytes: number; description: string; createdById: string; createdByName: string; createdAt: string; canEdit: boolean }
export interface FollowUp { id: string; campaignId: string; note: string; recommendation: string; ownerUserId: string | null; ownerName: string; dueDate: string | null; completed: boolean; completedAt: string | null; createdById: string; createdByName: string; createdAt: string; canEdit: boolean }
export interface CampaignDetail {
  campaign: Campaign;
  records: SavedRecord[];
  statusHistory: StatusChange[];
  creatives: Creative[];
  references: Reference[];
  followUps: FollowUp[];
  pacing: Omit<Pacing, 'spent' | 'remaining'> & { spent: string | null; remaining: string | null };
  alerts: CampaignAlert[];
  settings: AlertSettings;
  canEdit: boolean;
  isSystemOwner: boolean;
  today: string;
}
export interface Overview {
  activeCampaigns: number;
  campaignsTracked: number;
  spendByCurrency: { currency: Campaign['currency']; campaigns: number; spend: string | null }[];
  engagement: { interactions: number; completeCampaigns: number; incompleteCampaigns: number };
  objectiveCosts: { objective: string; currency: Campaign['currency']; campaigns: number; resultLabel: string; result: number | null; costLabel: string; cost: number | null }[];
  campaigns: { id: string; reference: string; name: string; status: string; objective: string; currency: Campaign['currency']; endDate: string; recordCount: number; trend: ({ metric: string } & TrendResult) | null; alerts: CampaignAlert[] }[];
  followUpsOpen: (Omit<FollowUp, 'canEdit'>)[];
  settings: AlertSettings;
}
export interface ImportPreview {
  missingColumns: string[];
  tooManyRows: boolean;
  summary: Record<'campaignsToCreate' | 'entriesToCreate' | 'entriesToUpdate' | 'skipped' | 'rejected', number>;
  rows: Omit<AnalysedRow, 'campaign' | 'entry'>[];
}
export interface ImportResult { importId: string; campaignsCreated: number; created: number; updated: number; skipped: number; rejected: number; rows: ImportPreview['rows'] }
export interface ImportHistoryItem { id: string; userName: string; fileName: string; mode: string; campaignsCreated: number; created: number; updated: number; skipped: number; rejected: number; createdAt: string }

/* ── Queries ───────────────────────────────────────────────────── */

export function useCampaignList(params: Record<string, string>) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== 'all')).toString();
  return useQuery({
    queryKey: [...ADS_KEY, 'campaigns', qs],
    queryFn: () => call<{ items: CampaignRow[]; total: number; page: number; pageSize: number }>(`/campaigns${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
  });
}

export const useCampaign = (id: string | undefined) => useQuery({
  queryKey: [...ADS_KEY, 'campaign', id],
  queryFn: () => call<CampaignDetail>(`/campaigns/${encodeURIComponent(id!)}`),
  enabled: Boolean(id),
});

export const useOverview = () => useQuery({ queryKey: [...ADS_KEY, 'overview'], queryFn: () => call<Overview>('/overview') });

export const useImportHistory = (page: number) => useQuery({
  queryKey: [...ADS_KEY, 'imports', page],
  queryFn: () => call<{ items: ImportHistoryItem[]; total: number; page: number; pageSize: number }>(`/imports?page=${page}`),
  placeholderData: keepPreviousData,
});

export const fetchImportErrors = (id: string) => call<{ rows: { row: number; reference: string; reportDate: string; action: string; errors: string[]; warnings: string[] }[] }>(`/imports/${encodeURIComponent(id)}/errors`);

export const useCompare = (ids: string[]) => useQuery({
  queryKey: [...ADS_KEY, 'compare', ids.join(',')],
  queryFn: () => call<{ campaigns: Campaign[]; records: (DailyRecord & { campaignId: string })[] }>(`/compare?ids=${ids.map(encodeURIComponent).join(',')}`),
  enabled: ids.length >= 2,
  retry: false,
});

/* ── Mutations ─────────────────────────────────────────────────── */

function useAdsMutation<V, R = unknown>(run: (v: V) => Promise<R>, success?: string | ((r: R) => string)) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (r) => {
      // Tables, charts, overview and history all derive from saved data: refresh them together.
      qc.invalidateQueries({ queryKey: ADS_KEY });
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      if (success) toast.success(typeof success === 'function' ? success(r) : success);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const useSaveCampaign = () => useAdsMutation(
  ({ id, ...body }: { id?: string } & Record<string, unknown>) => call<Campaign>(id ? `/campaigns/${id}` : '/campaigns', json(id ? 'PATCH' : 'POST', body)),
  'Campaign saved',
);
export const useRestoreCampaign = () => useAdsMutation(({ id, reason }: { id: string; reason: string }) => call<Campaign>(`/campaigns/${id}/restore`, json('POST', { reason })), 'Campaign restored');
export const useDeleteCampaign = () => useAdsMutation(({ id, reason }: { id: string; reason: string }) => call(`/campaigns/${id}`, json('DELETE', { reason })), 'Campaign deleted');

export const useSaveRecord = () => useAdsMutation(
  ({ id, campaignId, ...body }: { id?: string; campaignId: string } & Record<string, unknown>) =>
    call<{ record: SavedRecord; warnings: string[] }>(id ? `/records/${id}` : `/campaigns/${campaignId}/records`, json(id ? 'PATCH' : 'POST', body)),
  (r) => (r.warnings.length ? `Saved, with ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'} to check` : 'Daily record saved'),
);
export const useDeleteRecord = () => useAdsMutation(({ id, reason }: { id: string; reason: string }) => call(`/records/${id}`, json('DELETE', { reason })), 'Daily record deleted');

export const useUploadCreative = () => useAdsMutation(
  async ({ campaignId, file, adsUrl, usedFrom, usedTo, description }: { campaignId: string; file: File; adsUrl: string; usedFrom: string; usedTo: string; description: string }) =>
    call<{ id: string }>(`/campaigns/${campaignId}/creatives`, {
      method: 'POST', body: await file.arrayBuffer(),
      headers: {
        'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Ads-Url': encodeURIComponent(adsUrl),
        'X-Used-From': usedFrom, 'X-Used-To': usedTo, 'X-Description': encodeURIComponent(description),
      },
    }),
  'Creative uploaded',
);
export const useUpdateCreative = () => useAdsMutation(({ id, ...body }: { id: string } & Record<string, unknown>) => call(`/creatives/${id}`, json('PATCH', body)), 'Creative updated');
export const useRemoveCreative = () => useAdsMutation(({ id, reason }: { id: string; reason: string }) => call(`/creatives/${id}`, json('DELETE', { reason })), 'Creative removed');

export const useUploadReference = () => useAdsMutation(
  async ({ campaignId, file, description, dailyRecordId }: { campaignId: string; file: File; description: string; dailyRecordId: string }) =>
    call<{ id: string }>(`/campaigns/${campaignId}/references`, {
      method: 'POST', body: await file.arrayBuffer(),
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Description': encodeURIComponent(description), 'X-Daily-Record-Id': dailyRecordId },
    }),
  'Reference attached',
);
export const useRemoveReference = () => useAdsMutation(({ id, reason }: { id: string; reason: string }) => call(`/references/${id}`, json('DELETE', { reason })), 'Reference removed');

export const useSaveFollowUp = () => useAdsMutation(
  ({ id, campaignId, ...body }: { id?: string; campaignId: string } & Record<string, unknown>) => call(id ? `/followups/${id}` : `/campaigns/${campaignId}/followups`, json(id ? 'PATCH' : 'POST', body)),
  'Follow-up saved',
);
export const useDeleteFollowUp = () => useAdsMutation(({ id, reason }: { id: string; reason: string }) => call(`/followups/${id}`, json('DELETE', { reason })), 'Follow-up deleted');

export const useSaveSettings = () => useAdsMutation((body: Partial<AlertSettings>) => call<AlertSettings>('/settings', json('PATCH', body)), 'Alert thresholds saved');

export async function previewImport(file: File, mode: 'skip' | 'update'): Promise<ImportPreview> {
  return call<ImportPreview>(`/import/preview?mode=${mode}`, {
    method: 'POST', body: await file.arrayBuffer(), headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });
}

export const useCommitImport = () => useAdsMutation(
  async ({ file, mode, summary }: { file: File; mode: 'skip' | 'update'; summary: ImportPreview['summary'] }) =>
    call<ImportResult>(`/import/commit?mode=${mode}`, {
      method: 'POST', body: await file.arrayBuffer(),
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Expected-Summary': JSON.stringify(summary) },
    }),
  (r) => `Imported: ${r.created} created, ${r.updated} updated`,
);
