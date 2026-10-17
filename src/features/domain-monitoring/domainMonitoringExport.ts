/** Column definitions for every Domain Monitoring export scope. Each scope is
 *  registered with the global toolbar's Export button via
 *  useRegisterExport (see useDomainMonitoringExportSources.ts) — the existing
 *  ExportDialog already renders a "Table" picker once more than one source is
 *  registered, so no separate "Export Domains" button or dialog is needed here. */

import type { ExportColumn } from '@/lib/csv';
import type { DomainCheckLogEntry, DomainMonitorRecord } from '@/lib/types';

type PersonName = (id: string | null) => string;

export function domainMonitorColumns(personName: PersonName): ExportColumn<DomainMonitorRecord>[] {
  return [
    { key: 'id', header: 'ID', value: (r) => r.id },
    { key: 'domainType', header: 'Category', value: (r) => r.domainType },
    { key: 'domainName', header: 'Domain URL', value: (r) => r.domainName },
    { key: 'enabled', header: 'Enabled', value: (r) => (r.enabled ? 'Enabled' : 'Disabled') },
    { key: 'enabledDate', header: 'Date Enabled', value: (r) => r.enabledDate ?? '' },
    { key: 'nextRotationDate', header: 'Next Rotation Date', value: (r) => r.nextRotationDate ?? '' },
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
