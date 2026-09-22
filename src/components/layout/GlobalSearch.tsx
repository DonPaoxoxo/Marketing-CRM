import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { Input } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useCrmData } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { ALL_NAV_ITEMS } from './nav';
import { MIN_QUERY_LENGTH, searchRecords, type SearchHit } from '@/lib/search';

/** Authorised internal search across names, numbers, handles, agents, brands and IDs. */
export function GlobalSearch() {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const navigate = useNavigate();
  const { data, lookups } = useCrmData();
  const { showContactDetails: showContact, can } = useSession();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === '/' && !open && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const hits = React.useMemo<SearchHit[]>(() => {
    if (!data) return [];
    return searchRecords(
      {
        sims: data.sims,
        socialAccounts: data.socialAccounts,
        agents: data.agents,
        domains: data.domains,
        pakistanCompetitors: data.pakistanCompetitors,
        brands: data.brands,
        pages: ALL_NAV_ITEMS.filter((n) => !n.permission || can(n.permission)).map((n) => ({ to: n.to, label: n.label, description: n.description })),
      },
      q,
      { lookups: { platformName: lookups.platformName }, showContact },
    );
  }, [q, data, lookups, showContact, can]);

  React.useEffect(() => setCursor(0), [q]);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ('');
    navigate(h.to);
  };

  let lastGroup = '';

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full justify-start gap-2 text-muted-foreground sm:w-64"
      >
        <Search />
        <span className="flex-1 text-left">Search records…</span>
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" className="top-[12%] translate-y-0 gap-3 p-0">
          <div className="border-b border-border p-3">
            <DialogTitle className="sr-only">Search records</DialogTitle>
            <DialogDescription className="sr-only">
              Search by name, phone number, username, agent, brand or record ID.
            </DialogDescription>
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, number, handle, agent, brand or record ID…"
              aria-label="Search records"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
                if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); go(hits[cursor]); }
              }}
            />
          </div>
          <div className="max-h-[55vh] overflow-y-auto px-2 pb-3" role="listbox" aria-label="Search results">
            {q.trim().length < MIN_QUERY_LENGTH && (
              <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
                Type at least {MIN_QUERY_LENGTH} characters. Results are limited to records you are authorised to view.
              </p>
            )}
            {q.trim().length >= MIN_QUERY_LENGTH && hits.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">No records match “{q}”.</p>
            )}
            {hits.map((h, i) => {
              const header = h.group !== lastGroup ? h.group : null;
              lastGroup = h.group;
              return (
                <React.Fragment key={`${h.group}-${h.id}`}>
                  {header && (
                    <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(h)}
                    className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left ${i === cursor ? 'bg-muted' : ''}`}
                  >
                    <span className="text-[13px] font-medium">{h.title}</span>
                    <span className="text-[12px] text-muted-foreground">{h.subtitle}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
