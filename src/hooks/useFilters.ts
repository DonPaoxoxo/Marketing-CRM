import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Filters live in the URL so KPI drilldowns, saved views, browser history and
 *  shared links all reproduce the same filtered record set. */
export function useFilters<T extends Record<string, string>>(
  defaults: T,
  /** Keys that live in the URL but are not filters — a selected tab, say. They are
   *  left out of the active count and survive "Clear filters". */
  options: { notFilters?: (keyof T)[] } = {},
) {
  const [params, setParams] = useSearchParams();
  // Callers pass a fresh array literal each render; key on its contents so the
  // memos below are not invalidated every time.
  const notFilterKey = (options.notFilters ?? []).join(',');
  const notFilters = useMemo(
    () => (notFilterKey ? (notFilterKey.split(',') as (keyof T)[]) : []),
    [notFilterKey],
  );

  const values = useMemo(() => {
    const out = { ...defaults };
    (Object.keys(defaults) as (keyof T)[]).forEach((k) => {
      const v = params.get(String(k));
      if (v !== null) out[k] = v as T[keyof T];
    });
    return out;
  }, [params, defaults]);

  const set = useCallback(
    (patch: Partial<T>) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '' || v === defaults[k]) next.delete(k);
        else next.set(k, String(v));
      });
      setParams(next, { replace: true });
    },
    [params, setParams, defaults],
  );

  const clear = useCallback(() => {
    const next = new URLSearchParams();
    notFilters.forEach((k) => {
      const v = params.get(String(k));
      if (v !== null) next.set(String(k), v);
    });
    setParams(next, { replace: true });
  }, [params, setParams, notFilters]);

  const activeCount = useMemo(
    () => (Object.keys(defaults) as (keyof T)[])
      .filter((k) => !notFilters.includes(k))
      .filter((k) => values[k] !== defaults[k]).length,
    [values, defaults, notFilters],
  );

  return { values, set, clear, activeCount, isFiltered: activeCount > 0 };
}
