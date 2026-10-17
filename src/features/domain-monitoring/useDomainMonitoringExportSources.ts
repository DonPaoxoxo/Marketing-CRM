/** Registers every page-level export scope (the ones that do not depend on
 *  which tab is open) with the global toolbar. "Current Filtered Results" and
 *  "Selected Domains" are registered by DomainMonitorTable instead, since
 *  those two are tab-specific. */

import type { ExportColumn } from '@/lib/csv';
import { useRegisterExport } from '@/components/layout/page-actions';
import { useCrmData } from '@/hooks/useData';
import { addDays, toISODate } from '@/lib/utils';
import { useAllCheckLogHistory } from './api';
import { domainCheckLogColumns, domainMonitorColumns } from './domainMonitoringExport';

export function useDomainMonitoringExportSources() {
  const { data, lookups } = useCrmData();
  const monitors = data?.domainMonitors ?? [];

  const domainName = (id: string) => monitors.find((d) => d.id === id)?.domainName ?? id;
  const monitorColumns = domainMonitorColumns(lookups.personName) as unknown as ExportColumn<never>[];

  // Bounded to the last 90 days — daily checks are high-frequency and not part
  // of the bootstrap payload (see migration 019), so this is the one scope
  // that reaches the server instead of filtering data already in memory.
  const from = toISODate(addDays(new Date(), -90));
  const { data: checkLogs } = useAllCheckLogHistory(true, { from });

  useRegisterExport({
    label: 'All Domains', filename: 'domain-monitoring-all', recordType: 'Domain Monitor',
    rows: monitors, columns: monitorColumns,
  });
  useRegisterExport({
    label: 'Free Cash Domains', filename: 'domain-monitoring-free-cash', recordType: 'Domain Monitor',
    rows: monitors.filter((d) => d.domainType === 'Free Cash'), columns: monitorColumns,
  });
  useRegisterExport({
    label: 'Invite Domains', filename: 'domain-monitoring-invite', recordType: 'Domain Monitor',
    rows: monitors.filter((d) => d.domainType === 'Invite'), columns: monitorColumns,
  });
  useRegisterExport({
    label: 'Enabled Invite Domains', filename: 'domain-monitoring-invite-enabled', recordType: 'Domain Monitor',
    rows: monitors.filter((d) => d.domainType === 'Invite' && d.enabled), columns: monitorColumns,
  });
  useRegisterExport({
    label: 'Disabled Invite Domains', filename: 'domain-monitoring-invite-disabled', recordType: 'Domain Monitor',
    rows: monitors.filter((d) => d.domainType === 'Invite' && !d.enabled), columns: monitorColumns,
  });
  useRegisterExport({
    label: 'Daily Monitoring History (90 days)', filename: 'domain-monitoring-daily-history', recordType: 'Domain Check Log',
    rows: checkLogs ?? [], columns: domainCheckLogColumns(domainName, lookups.personName) as unknown as ExportColumn<never>[],
  });
}
