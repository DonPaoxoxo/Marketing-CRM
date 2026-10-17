/** Column definitions for every Domain Monitoring & Rotation export scope.
 *  Each scope is registered with the global toolbar's Export button via
 *  useRegisterExport (see useDomainMonitoringExportSources.ts) — the existing
 *  ExportDialog already renders a "Table" picker once more than one source is
 *  registered, so no separate "Export Domains" button or dialog is needed here. */

import type { ExportColumn } from '@/lib/csv';
import type { DomainCheckLogEntry, DomainMonitorRecord, RotationBatchRecord, RotationEventRecord } from '@/lib/types';

type PersonName = (id: string | null) => string;

export function domainMonitorColumns(personName: PersonName): ExportColumn<DomainMonitorRecord>[] {
  return [
    { key: 'id', header: 'ID', value: (r) => r.id },
    { key: 'domainType', header: 'Category', value: (r) => r.domainType },
    { key: 'domainName', header: 'Domain URL', value: (r) => r.domainName },
    { key: 'activationStatus', header: 'Activation Status', value: (r) => r.activationStatus ?? '' },
    { key: 'lastAccessibilityStatus', header: 'Accessibility', value: (r) => r.lastAccessibilityStatus },
    { key: 'lastCheckedDate', header: 'Last Checked', value: (r) => r.lastCheckedDate ?? '' },
    { key: 'lastCheckedBy', header: 'Checked By', value: (r) => personName(r.lastCheckedById) },
    { key: 'notes', header: 'Notes', value: (r) => r.notes },
    { key: 'archived', header: 'Archived', value: (r) => (r.archived ? 'Yes' : 'No') },
    { key: 'createdAt', header: 'Added', value: (r) => r.createdAt },
  ];
}

export function domainCheckLogColumns(domainName: (id: string) => string, personName: PersonName): ExportColumn<DomainCheckLogEntry>[] {
  return [
    { key: 'checkDate', header: 'Date', value: (r) => r.checkDate },
    { key: 'domainName', header: 'Domain URL', value: (r) => domainName(r.domainMonitorId) },
    { key: 'accessibilityStatus', header: 'Accessibility', value: (r) => r.accessibilityStatus },
    { key: 'checkedBy', header: 'Checked By', value: (r) => personName(r.checkedById) },
    { key: 'notes', header: 'Notes', value: (r) => r.notes },
  ];
}

export function rotationBatchColumns(groupName: (id: string) => string): ExportColumn<RotationBatchRecord>[] {
  return [
    { key: 'id', header: 'ID', value: (r) => r.id },
    { key: 'group', header: 'Rotation Group', value: (r) => groupName(r.rotationGroupId) },
    { key: 'name', header: 'Batch', value: (r) => r.name },
    { key: 'status', header: 'Status', value: (r) => r.status },
    { key: 'archived', header: 'Archived', value: (r) => (r.archived ? 'Yes' : 'No') },
  ];
}

export function rotationEventColumns(
  groupName: (id: string) => string,
  batchName: (id: string | null) => string,
  personName: PersonName,
): ExportColumn<RotationEventRecord>[] {
  return [
    { key: 'performedAt', header: 'When', value: (r) => r.performedAt },
    { key: 'group', header: 'Rotation Group', value: (r) => groupName(r.rotationGroupId) },
    { key: 'eventType', header: 'Event', value: (r) => r.eventType },
    { key: 'outgoing', header: 'Outgoing Batch', value: (r) => batchName(r.outgoingBatchId) },
    { key: 'incoming', header: 'Incoming Batch', value: (r) => batchName(r.incomingBatchId) },
    { key: 'isOverride', header: 'Override', value: (r) => (r.isOverride ? 'Yes' : 'No') },
    { key: 'reason', header: 'Reason', value: (r) => r.reason },
    { key: 'performedBy', header: 'Performed By', value: (r) => personName(r.performedById) },
  ];
}
