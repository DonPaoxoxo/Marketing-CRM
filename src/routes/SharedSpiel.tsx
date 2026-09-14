import * as React from 'react';
import { Megaphone, Plus, Star, TrendingUp } from 'lucide-react';
import { PageHeader, EmptyState, ErrorState } from '@/components/common/bits';
import { FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/cn';
import { SPIEL_PLATFORMS, SPIEL_STATUSES, TARGET_COUNTRIES, isSpielOwner, plainText, recommendedForToday, type Spiel, type SpielDetail } from '@/lib/spiels';
import { useCategories, useDocuments, useLibrary, useMySpiels, useReviews, useSpielPersonal, type LibrarySpiel } from '@/features/spiels/api';
import { CopyButtons, SpielLabels, SpielStatusBadge } from '@/features/spiels/bits';
import { SpielEditor } from '@/features/spiels/SpielEditor';
import { SpielDetailDrawer } from '@/features/spiels/SpielDetail';
import { DocumentsTab } from '@/features/spiels/Documents';
import { AiAssistant } from '@/features/spiels/AiAssistant';
import { OwnerSettings } from '@/features/spiels/OwnerSettings';

export const SPIEL_SUBTITLE = 'Submit, review, improve, and reuse approved communication scripts across the marketing team.';

const DEFAULTS = { tab: 'library', spiel: '', document: '', category: 'all', search: '', country: 'all', language: 'all', platform: 'all', author: 'all', status: 'all', sort: 'newest', favorites: '' };

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'most-used', label: 'Most used' },
  { value: 'recently-approved', label: 'Recently approved' },
  { value: 'updated', label: 'Last updated' },
];

function sortSpiels<T extends Spiel>(list: T[], sort: string): T[] {
  const by = {
    newest: (s: T) => s.createdAt,
    'most-used': (s: T) => String(s.usageCount).padStart(9, '0'),
    'recently-approved': (s: T) => s.approvedAt ?? '',
    updated: (s: T) => s.updatedAt,
  }[sort] ?? ((s: T) => s.createdAt);
  return [...list].sort((a, b) => by(b).localeCompare(by(a)));
}

export default function SharedSpielPage() {
  const filters = useFilters(DEFAULTS, { notFilters: ['tab', 'spiel', 'document', 'sort', 'category'] });
  const { values, set } = filters;
  const { actorId, role, can } = useSession();
  const owner = isSpielOwner({ id: actorId, role });
  const library = useLibrary();
  const mine = useMySpiels();
  const reviews = useReviews(owner);
  const documents = useDocuments();
  const [editor, setEditor] = React.useState<{ open: boolean; spiel: SpielDetail | null }>({ open: false, spiel: null });
  const mayWrite = library.data?.mayWrite ?? can('edit:resources');
  const pendingDocs = (documents.data ?? []).filter((d) => d.status === 'Pending Review');
  const spielOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of [...(library.data?.spiels ?? []), ...(mine.data ?? [])]) seen.set(s.id, s.current.title);
    return [...seen].map(([id, title]) => ({ id, title }));
  }, [library.data, mine.data]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="Shared Spiel Library"
        description={SPIEL_SUBTITLE}
        actions={mayWrite && <Button onClick={() => setEditor({ open: true, spiel: null })}><Plus /> New spiel</Button>}
      />

      {library.data?.announcement && (
        <aside role="note" className="flex gap-2 rounded-lg border border-primary/30 bg-accent/40 p-3 text-[13px]">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span><span className="font-semibold">Announcement: </span><span className="whitespace-pre-wrap">{library.data.announcement}</span></span>
        </aside>
      )}

      <Tabs value={values.tab} onValueChange={(tab) => set({ tab })}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="library">Approved Library</TabsTrigger>
          <TabsTrigger value="mine">My Submissions{mine.data?.length ? ` (${mine.data.length})` : ''}</TabsTrigger>
          {owner && <TabsTrigger value="reviews">Pending Reviews{reviews.data || documents.data ? ` (${(reviews.data?.length ?? 0) + pendingDocs.length})` : ''}</TabsTrigger>}
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="assistant">AI Assistant</TabsTrigger>
          {owner && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="library" className="mt-4">
          <LibraryTab filters={filters} onOpen={(spiel) => set({ spiel })} />
        </TabsContent>

        <TabsContent value="mine" className="mt-4">
          <SpielList
            query={mine}
            onOpen={(spiel) => set({ spiel })}
            statusFilter={values.status}
            onStatus={(status) => set({ status })}
            empty={<EmptyState title="You have not written any spiels yet" description="Save a draft or submit a spiel for approval." action={mayWrite && <Button size="sm" onClick={() => setEditor({ open: true, spiel: null })}><Plus /> New spiel</Button>} />}
          />
        </TabsContent>

        {owner && (
          <TabsContent value="reviews" className="mt-4 flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Spiels waiting for approval</h2>
              <SpielList query={reviews} onOpen={(spiel) => set({ spiel })} showAuthor empty={<EmptyState title="Nothing to review" description="New submissions and edited approved spiels appear here." />} />
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Documents waiting for review</h2>
              {pendingDocs.length === 0 ? <p className="text-[13px] text-muted-foreground">No documents waiting.</p> : (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {pendingDocs.map((d) => (
                    <li key={d.id}>
                      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-muted/50" onClick={() => set({ tab: 'documents', document: d.id })}>
                        <span className="text-[13px] font-medium">{d.title} <span className="font-normal text-muted-foreground">· {d.current.fileName} · v{d.current.versionNo} · {d.createdByName}</span></span>
                        <SpielStatusBadge status={d.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>
        )}

        <TabsContent value="documents" className="mt-4">
          <DocumentsTab openId={values.document || null} onOpen={(document) => set({ document: document ?? '' })} spiels={spielOptions} />
        </TabsContent>

        <TabsContent value="assistant" className="mt-4">
          <div className="mx-auto max-w-3xl"><AiAssistant /></div>
        </TabsContent>

        {owner && (
          <TabsContent value="settings" className="mt-4">
            <OwnerSettings />
          </TabsContent>
        )}
      </Tabs>

      <SpielDetailDrawer id={values.spiel || null} onClose={() => set({ spiel: '' })} onEdit={(spiel) => setEditor({ open: true, spiel })} />
      <SpielEditor open={editor.open} spiel={editor.spiel} onOpenChange={(open) => setEditor((e) => ({ ...e, open }))} onSaved={(s) => set({ spiel: s.id })} />
    </div>
  );
}

/* ── Library ──────────────────────────────────────────────────── */

function LibraryTab({ filters, onOpen }: { filters: ReturnType<typeof useFilters<typeof DEFAULTS>>; onOpen: (id: string) => void }) {
  const { values, set, clear, activeCount } = filters;
  const library = useLibrary();
  const categories = useCategories();
  if (library.error) return <ErrorState message={library.error.message} onRetry={() => library.refetch()} />;
  if (library.isLoading || !library.data) return <Skeleton className="h-64 w-full" />;
  const all = library.data.spiels;
  const q = values.search.trim().toLowerCase();
  const filtered = sortSpiels(all.filter((s) => {
    const v = s.current;
    return (values.category === 'all' || v.categoryId === values.category)
      && (values.country === 'all' || v.targetCountry === values.country || (v.targetCountry === 'Both' && ['India', 'Indonesia'].includes(values.country)))
      && (values.language === 'all' || v.language === values.language)
      && (values.platform === 'all' || v.platform === values.platform)
      && (values.author === 'all' || s.createdById === values.author)
      && (!values.favorites || s.favorite)
      && (!q || `${v.title} ${v.content} ${v.tags.join(' ')} ${v.categoryName} ${v.situation}`.toLowerCase().includes(q));
  }), values.sort);
  const languages = [...new Set(all.map((s) => s.current.language))].sort();
  const authors = [...new Map(all.map((s) => [s.createdById, s.createdByName])).entries()];
  const counts = new Map<string, number>();
  for (const s of all) counts.set(s.current.categoryId, (counts.get(s.current.categoryId) ?? 0) + 1);
  const topUsage = Math.max(0, ...all.map((s) => s.usageCount));
  const showSections = !q && activeCount === 0 && values.category === 'all' && all.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {showSections && (
        <div className="grid gap-3 lg:grid-cols-3">
          <MiniList title="Recommended for Today" items={recommendedForToday(all, library.data.today, 4)} onOpen={onOpen} />
          <MiniList title="Recently Approved" items={sortSpiels(all, 'recently-approved').slice(0, 4)} onOpen={onOpen} meta={(s) => formatDate(s.approvedAt?.slice(0, 10))} />
          <MiniList title="Most Used" items={sortSpiels(all, 'most-used').filter((s) => s.usageCount > 0).slice(0, 4)} onOpen={onOpen} meta={(s) => `${s.usageCount} use${s.usageCount === 1 ? '' : 's'}`} empty="Copy a spiel to start counting." />
        </div>
      )}

      <nav aria-label="Categories" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {[{ id: 'all', name: 'All categories' }, ...(categories.data ?? []).filter((c) => c.active || counts.has(c.id))].map((c) => (
          <button key={c.id} type="button" aria-pressed={values.category === c.id} onClick={() => set({ category: c.id })}
            className={cn('shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors', values.category === c.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface text-muted-foreground hover:text-foreground')}>
            {c.name}{c.id !== 'all' && counts.get(c.id) ? ` (${counts.get(c.id)})` : c.id === 'all' ? ` (${all.length})` : ''}
          </button>
        ))}
      </nav>

      <FilterBar activeCount={activeCount} onClear={clear}>
        <SearchInput id="spiel-search" label="Search spiels" value={values.search} onChange={(search) => set({ search })} placeholder="Search title, script, tag or category…" className="min-w-[14rem] flex-1" />
        <FilterSelect id="spiel-country" label="Country" value={values.country} onChange={(country) => set({ country })} options={[{ value: 'all', label: 'All' }, ...TARGET_COUNTRIES.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect id="spiel-language" label="Language" value={values.language} onChange={(language) => set({ language })} options={[{ value: 'all', label: 'All' }, ...languages.map((l) => ({ value: l, label: l }))]} />
        <FilterSelect id="spiel-platform" label="Platform" value={values.platform} onChange={(platform) => set({ platform })} options={[{ value: 'all', label: 'All' }, ...SPIEL_PLATFORMS.map((p) => ({ value: p, label: p }))]} />
        <FilterSelect id="spiel-author" label="Author" value={values.author} onChange={(author) => set({ author })} options={[{ value: 'all', label: 'All' }, ...authors.map(([id, name]) => ({ value: id, label: name }))]} />
        <FilterSelect id="spiel-sort" label="Sort" value={values.sort} onChange={(sort) => set({ sort })} options={SORTS} />
        <Button size="sm" variant={values.favorites ? 'default' : 'outline'} aria-pressed={Boolean(values.favorites)} className="self-end" onClick={() => set({ favorites: values.favorites ? '' : '1' })}>
          <Star /> Favorites
        </Button>
      </FilterBar>

      <p className="text-[12px] text-muted-foreground" aria-live="polite">{filtered.length} approved spiel{filtered.length === 1 ? '' : 's'}</p>
      {filtered.length === 0 ? (
        <EmptyState title={all.length ? 'No spiels match' : 'No approved spiels yet'} description={all.length ? 'Try other filters or search words.' : 'Approved spiels appear here for the whole team.'} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => <li key={s.id}><SpielCard spiel={s} onOpen={onOpen} mostUsed={topUsage > 0 && s.usageCount === topUsage} /></li>)}
        </ul>
      )}
    </div>
  );
}

function SpielCard({ spiel: s, onOpen, mostUsed }: { spiel: LibrarySpiel; onOpen: (id: string) => void; mostUsed: boolean }) {
  const personal = useSpielPersonal();
  const v = s.current;
  return (
    <article aria-labelledby={`spiel-card-${s.id}`} className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <header className="flex items-start justify-between gap-2">
        <h3 id={`spiel-card-${s.id}`} className="text-[14px] font-semibold leading-snug">{v.title}</h3>
        <Button size="icon-sm" variant="ghost" aria-pressed={s.favorite} aria-label={s.favorite ? `Remove ${v.title} from favorites` : `Add ${v.title} to favorites`}
          onClick={() => personal.favorite.mutate({ id: s.id, favorite: !s.favorite })}>
          <Star className={s.favorite ? 'fill-warning text-warning' : ''} />
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">{v.categoryName}</Badge>
        {mostUsed && <Badge tone="success"><TrendingUp className="size-3" /> Most used</Badge>}
        {s.pendingVersion && s.canEdit && <Badge tone="warning">New version pending</Badge>}
      </div>
      <SpielLabels country={v.targetCountry} language={v.language} platform={v.platform} />
      <p className="line-clamp-4 whitespace-pre-wrap text-[13px] text-foreground/90">{plainText(v.content)}</p>
      <p className="mt-auto text-[11px] text-muted-foreground">v{v.versionNo} · approved {formatDate(s.approvedAt?.slice(0, 10))} · {s.usageCount} use{s.usageCount === 1 ? '' : 's'}</p>
      <footer className="flex flex-wrap items-center gap-2">
        <CopyButtons compact text={v.content} platform={v.platform} onCopied={() => personal.use.mutate(s.id)} />
        <Button size="sm" variant="ghost" onClick={() => onOpen(s.id)}>View details</Button>
      </footer>
    </article>
  );
}

function MiniList({ title, items, onOpen, meta, empty = 'Nothing yet.' }: { title: string; items: Spiel[]; onOpen: (id: string) => void; meta?: (s: Spiel) => string; empty?: string }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3" aria-label={title}>
      <h2 className="mb-1.5 text-[13px] font-semibold">{title}</h2>
      {items.length === 0 ? <p className="text-[12px] text-muted-foreground">{empty}</p> : (
        <ul className="flex flex-col gap-1">
          {items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-[12px] hover:bg-muted">
                <span className="truncate">{s.current.title} <span className="text-muted-foreground">· {s.current.categoryName}</span></span>
                {meta && <span className="shrink-0 text-muted-foreground">{meta(s)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Submissions list ─────────────────────────────────────────── */

function SpielList({ query, onOpen, empty, showAuthor, statusFilter, onStatus }: {
  query: { data?: Spiel[]; error: Error | null; isLoading: boolean; refetch: () => unknown };
  onOpen: (id: string) => void;
  empty: React.ReactNode;
  showAuthor?: boolean;
  statusFilter?: string;
  onStatus?: (s: string) => void;
}) {
  if (query.error) return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />;
  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  const list = (query.data ?? []).filter((s) => !statusFilter || statusFilter === 'all' || s.status === statusFilter);
  return (
    <div className="flex flex-col gap-2">
      {onStatus && (
        <div className="max-w-xs">
          <FilterSelect id="mine-status" label="Status" value={statusFilter ?? 'all'} onChange={onStatus} options={[{ value: 'all', label: 'All' }, ...SPIEL_STATUSES.map((s) => ({ value: s, label: s }))]} />
        </div>
      )}
      {list.length === 0 ? empty : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen(s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-muted/50">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium">{s.current.title}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {s.current.categoryName} · v{s.current.versionNo}{showAuthor ? ` · ${s.createdByName}` : ''} · updated {formatDate(s.updatedAt.slice(0, 10))}
                    {s.approved && s.approved.id !== s.current.id ? ` · v${s.approved.versionNo} live` : ''}
                  </span>
                  {s.current.adminFeedback && ['Rejected', 'Changes Requested'].includes(s.status) && <span className="text-[12px] text-danger">Feedback: {s.current.adminFeedback}</span>}
                </span>
                <SpielStatusBadge status={s.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
