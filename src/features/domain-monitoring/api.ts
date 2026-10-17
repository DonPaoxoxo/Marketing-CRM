/** Domain Monitoring & Rotation: the calls behind the pages, kept in their own
 *  file rather than growing the already-large hooks/useData.ts — this module
 *  has far more mutations than any single register, the same reasoning
 *  src/features/ads/api.ts follows. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ApiError, BOOTSTRAP_KEY, useActorQuery, withActor,
} from '@/hooks/useData';
import type {
  DomainAccessibilityStatus, DomainCheckLogEntry, DomainMonitorType, DomainMonitorRecord,
  RotationBatchRecord, RotationGroupRecord,
} from '@/lib/types';

async function call<T>(url: string, actorQuery: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(withActor(`/api/domain-monitoring${url}`, actorQuery), {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(body.message ?? 'Request failed', res.status, body.field, body.conflictId);
  }
  return res.json() as Promise<T>;
}

function useDomainMonitoringMutation<V, R>(run: (v: V, actorQuery: string) => Promise<R>, success?: string | ((r: R) => string)) {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    mutationFn: (v: V) => run(v, actorQuery),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      if (success) toast.success(typeof success === 'function' ? success(r) : success);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/* ── Monitors ────────────────────────────────────────────────────── */

export const useCreateDomainMonitor = () => useDomainMonitoringMutation(
  (body: Record<string, unknown>, q) => call<DomainMonitorRecord>('', q, { method: 'POST', body: JSON.stringify(body) }),
  'Domain added',
);

export const useUpdateDomainMonitor = () => useDomainMonitoringMutation(
  ({ id, ...body }: { id: string } & Record<string, unknown>, q) =>
    call<DomainMonitorRecord>(`/${id}`, q, { method: 'PATCH', body: JSON.stringify(body) }),
  'Domain updated',
);

/* ── Bulk add (paste, one domain per line) ───────────────────────── */

export interface BulkAddResult { created: number; skipped: number; problems: { line: number; reason: string }[] }

export const useBulkAddDomainMonitors = () => useDomainMonitoringMutation(
  (body: { domainType: DomainMonitorType; lines: string[]; notes?: string; reason?: string }, q) =>
    call<BulkAddResult>('/bulk', q, { method: 'POST', body: JSON.stringify(body) }),
  (r: BulkAddResult) => `${r.created} domain${r.created === 1 ? '' : 's'} added${r.skipped ? `, ${r.skipped} skipped` : ''}`,
);

/* ── Rotation groups & batches (configuration only) ──────────────── */

export const useCreateRotationGroup = () => useDomainMonitoringMutation(
  (body: { name: string; notes?: string; rotationIntervalDays?: number; reason?: string }, q) =>
    call<RotationGroupRecord>('/groups', q, { method: 'POST', body: JSON.stringify(body) }),
  'Rotation group created',
);

export const useUpdateRotationGroup = () => useDomainMonitoringMutation(
  ({ id, ...body }: { id: string } & Record<string, unknown>, q) =>
    call<RotationGroupRecord>(`/groups/${id}`, q, { method: 'PATCH', body: JSON.stringify(body) }),
  'Rotation group updated',
);

export const useCreateRotationBatch = () => useDomainMonitoringMutation(
  ({ groupId, ...body }: { groupId: string; name: string; reason?: string }, q) =>
    call<RotationBatchRecord>(`/groups/${groupId}/batches`, q, { method: 'POST', body: JSON.stringify(body) }),
  'Rotation batch created',
);

export const useUpdateRotationBatch = () => useDomainMonitoringMutation(
  ({ id, ...body }: { id: string } & Record<string, unknown>, q) =>
    call<RotationBatchRecord>(`/batches/${id}`, q, { method: 'PATCH', body: JSON.stringify(body) }),
  'Rotation batch updated',
);

export const useReplaceBatchMembers = () => useDomainMonitoringMutation(
  ({ id, domainMonitorIds }: { id: string; domainMonitorIds: string[] }, q) =>
    call<{ rotationBatchId: string; domainMonitorIds: string[] }>(`/batches/${id}/members`, q, { method: 'PUT', body: JSON.stringify({ domainMonitorIds }) }),
  'Batch membership updated',
);

/* ── Running a rotation ──────────────────────────────────────────── */

export const useRotateFull = () => useDomainMonitoringMutation(
  ({ groupId, ...body }: { groupId: string; incomingBatchId: string; reason: string }, q) =>
    call<RotationGroupRecord>(`/groups/${groupId}/rotate-full`, q, { method: 'POST', body: JSON.stringify(body) }),
  'Rotation complete',
);

export const useRotatePartial = () => useDomainMonitoringMutation(
  ({ groupId, ...body }: { groupId: string; moves: { domainMonitorId: string; toBatchId: string }[]; reason: string }, q) =>
    call<RotationGroupRecord>(`/groups/${groupId}/rotate-partial`, q, { method: 'POST', body: JSON.stringify(body) }),
  'Partial rotation complete',
);

export const useRotationOverride = () => useDomainMonitoringMutation(
  ({ groupId, ...body }: { groupId: string; action: string; newDueAt?: string; newIntervalDays?: number; reason: string }, q) =>
    call<RotationGroupRecord>(`/groups/${groupId}/override`, q, { method: 'POST', body: JSON.stringify(body) }),
  'Schedule override applied',
);

/* ── Accessibility checks ────────────────────────────────────────── */

export const useRecordAccessibilityCheck = () => useDomainMonitoringMutation(
  ({ id, ...body }: { id: string; accessibilityStatus: DomainAccessibilityStatus; notes?: string }, q) =>
    call<DomainMonitorRecord>(`/${id}/checks`, q, { method: 'POST', body: JSON.stringify(body) }),
  'Check recorded',
);

export interface BulkCheckResult { updated: number; skipped: number; problems: { domainId: string; reason: string }[] }

export const useBulkRecordAccessibilityCheck = () => useDomainMonitoringMutation(
  (body: { domainMonitorIds: string[]; accessibilityStatus: DomainAccessibilityStatus; notes?: string }, q) =>
    call<BulkCheckResult>('/bulk-checks', q, { method: 'POST', body: JSON.stringify(body) }),
  (r: BulkCheckResult) => `${r.updated} domain${r.updated === 1 ? '' : 's'} checked${r.skipped ? `, ${r.skipped} skipped` : ''}`,
);

export function useCheckLogHistory(domainId: string | undefined, range?: { from?: string; to?: string }) {
  const actorQuery = useActorQuery();
  return useQuery({
    queryKey: ['domain-monitoring', 'checks', domainId, range],
    queryFn: () => {
      const params = new URLSearchParams();
      if (range?.from) params.set('from', range.from);
      if (range?.to) params.set('to', range.to);
      const qs = params.toString();
      return call<DomainCheckLogEntry[]>(`/${domainId}/checks${qs ? `?${qs}` : ''}`, actorQuery);
    },
    enabled: Boolean(domainId),
  });
}

/** Across every domain — backs the "Daily Monitoring History" export scope,
 *  since check logs are deliberately not part of the bootstrap payload. */
export function useAllCheckLogHistory(enabled: boolean, range?: { from?: string; to?: string }) {
  const actorQuery = useActorQuery();
  return useQuery({
    queryKey: ['domain-monitoring', 'all-checks', range],
    queryFn: () => {
      const params = new URLSearchParams();
      if (range?.from) params.set('from', range.from);
      if (range?.to) params.set('to', range.to);
      const qs = params.toString();
      return call<DomainCheckLogEntry[]>(`/checks${qs ? `?${qs}` : ''}`, actorQuery);
    },
    enabled,
  });
}
