/** What the global toolbar can act on for the page that is open.
 *
 *  Pages do not wire anything up by hand: every `ExportButton` registers its rows
 *  as an export source and every `FilterBar` registers its "clear" action, so the
 *  toolbar's Export, Filter and Clear filters work on any page that has them. The
 *  registry holds getters, so rows that change on every render cost nothing here. */

import * as React from 'react';
import type { ExportColumn } from '@/lib/csv';

export interface ExportSource {
  label: string;
  filename: string;
  recordType: string;
  disabledReason?: string;
  // Rows and columns of any record type; the dialog only reads them through the columns.
  rows: unknown[];
  columns: ExportColumn<never>[];
}

interface FilterSource { clear: () => void; activeCount: number; elementRef: React.RefObject<HTMLElement | null> }

interface Registry {
  exports: Map<string, () => ExportSource>;
  filters: Map<string, () => FilterSource>;
  version: number;
  bump: () => void;
}

const PageActionsContext = React.createContext<Registry | null>(null);

export function PageActionsProvider({ children }: { children: React.ReactNode }) {
  const exports = React.useRef(new Map<string, () => ExportSource>()).current;
  const filters = React.useRef(new Map<string, () => FilterSource>()).current;
  const [version, setVersion] = React.useState(0);
  const bump = React.useCallback(() => setVersion((v) => v + 1), []);
  const value = React.useMemo(() => ({ exports, filters, version, bump }), [exports, filters, version, bump]);
  return <PageActionsContext.Provider value={value}>{children}</PageActionsContext.Provider>;
}

/** The toolbar's view of the registry. Empty outside the app shell (tests, login). */
export function usePageActions() {
  const registry = React.useContext(PageActionsContext);
  return React.useMemo(() => ({
    exportSources: registry ? [...registry.exports.values()].map((get) => get()) : [],
    filterSource: registry ? [...registry.filters.values()].map((get) => get())[0] ?? null : null,
    version: registry?.version ?? 0,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [registry, registry?.version]);
}

/** Register an export source for as long as the component is mounted. */
export function useRegisterExport(source: ExportSource) {
  const registry = React.useContext(PageActionsContext);
  const id = React.useId();
  const latest = React.useRef(source);
  latest.current = source;
  React.useEffect(() => {
    if (!registry) return;
    registry.exports.set(id, () => latest.current);
    registry.bump();
    return () => { registry.exports.delete(id); registry.bump(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry?.exports, id]);
}

/** Register a filter bar. Re-announces itself when its active count changes so Clear filters enables. */
export function useRegisterFilters(source: FilterSource) {
  const registry = React.useContext(PageActionsContext);
  const id = React.useId();
  const latest = React.useRef(source);
  latest.current = source;
  React.useEffect(() => {
    if (!registry) return;
    registry.filters.set(id, () => latest.current);
    registry.bump();
    return () => { registry.filters.delete(id); registry.bump(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry?.filters, id]);
  React.useEffect(() => { registry?.bump(); }, [source.activeCount]); // eslint-disable-line react-hooks/exhaustive-deps
}
