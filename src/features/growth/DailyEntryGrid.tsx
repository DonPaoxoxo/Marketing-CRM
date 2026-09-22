import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Input, Label, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { EmptyState, SafeExternalLink, SectionCard } from '@/components/common/bits';
import { SearchInput } from '@/components/common/controls';
import { BOOTSTRAP_KEY, ApiError, useActorQuery, useCrmData, useUpdate, withActor } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { latestSnapshot, trackableAccounts } from '@/lib/growth';
import type { SocialAccount } from '@/lib/types';
import { displayUrl, formatDate, toISODate } from '@/lib/utils';
import { cn } from '@/lib/cn';

interface Draft {
  [accountId: string]: string;
}

/** The market an account is sorted under. Editable here so the team can tag
 *  an account without a trip to its own record — restricted to the three
 *  markets Growth tracks, even though the underlying field allows any country. */
const SORT_MARKETS = ['Pakistan', 'India', 'Indonesia'] as const;

/**
 * The daily routine: pick a date, type down the column, save once.
 *
 * The *total* is entered, never the gain — the gain shown beside each input is
 * derived from that account's previous snapshot, so a day nobody recorded still
 * produces a correct multi-day figure rather than a broken series.
 */
export function DailyEntryGrid() {
  const { data, lookups, isLoading } = useCrmData();
  const { can } = useSession();
  const actorQuery = useActorQuery();
  const qc = useQueryClient();
  const mayEdit = can('edit:resources');
  const updateSort = useUpdate<SocialAccount>('social-accounts', 'Account');

  const sortOptions = React.useMemo(
    () => (data?.countries ?? [])
      .filter((c) => (SORT_MARKETS as readonly string[]).includes(c.name))
      .sort((a, b) => SORT_MARKETS.indexOf(a.name as typeof SORT_MARKETS[number]) - SORT_MARKETS.indexOf(b.name as typeof SORT_MARKETS[number])),
    [data],
  );

  const today = toISODate(new Date());
  const [date, setDate] = React.useState(today);
  const [search, setSearch] = React.useState('');
  const [draft, setDraft] = React.useState<Draft>({});

  const accounts = React.useMemo(
    () => (data ? trackableAccounts(data.socialAccounts) : []),
    [data],
  );

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return accounts
      .filter((a) => !needle || `${a.username} ${a.displayName} ${lookups.brandName(a.brandId)} ${a.profileUrl}`.toLowerCase().includes(needle))
      .map((a) => {
        const snapshots = data?.followerSnapshots ?? [];
        const onDate = snapshots.find((s) => s.accountId === a.id && s.date === date);
        // "Previous" means the newest entry strictly before the chosen date, so
        // back-filling an older day still compares against the right baseline.
        const previous = snapshots
          .filter((s) => s.accountId === a.id && s.date < date)
          .reduce<{ date: string; followerCount: number } | null>((best, s) => (best && best.date >= s.date ? best : s), null);
        return { account: a, onDate, previous, latest: latestSnapshot(snapshots, a.id) };
      });
  }, [accounts, data, date, search, lookups]);

  // Reset the draft whenever the date changes — numbers belong to one day.
  React.useEffect(() => setDraft({}), [date]);

  const entries = React.useMemo(
    () => Object.entries(draft)
      .filter(([, v]) => v.trim() !== '')
      .map(([accountId, v]) => ({ accountId, followerCount: Number(v) })),
    [draft],
  );

  const invalidEntries = entries.filter(
    (e) => !Number.isInteger(e.followerCount) || e.followerCount < 0,
  );

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(withActor('/api/follower-snapshots/bulk', actorQuery), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, entries, reason: `Daily follower entry for ${date}` }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new ApiError(body.message ?? 'Could not save', res.status, body.field);
      }
      return res.json() as Promise<{ created: number; corrected: number }>;
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      setDraft({});
      toast.success(`Saved ${r.created + r.corrected} account${r.created + r.corrected === 1 ? '' : 's'} for ${formatDate(date)}`, {
        description: r.corrected ? `${r.corrected} existing figure${r.corrected === 1 ? '' : 's'} corrected.` : undefined,
      });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const recordedCount = rows.filter((r) => r.onDate).length;
  const futureDate = date > today;

  return (
    <SectionCard
      title="Daily follower entry"
      description="Enter each account's running total. The gain is worked out for you."
      actions={
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={!mayEdit || !entries.length || invalidEntries.length > 0 || futureDate || save.isPending}
          title={!mayEdit ? 'Your role cannot record figures.' : undefined}
        >
          <Save /> {save.isPending ? 'Saving…' : `Save ${entries.length || ''} ${entries.length === 1 ? 'entry' : 'entries'}`.trim()}
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="growth-date" className="text-[11px] uppercase tracking-wide text-muted-foreground">Date</Label>
          <Input
            id="growth-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
            aria-invalid={futureDate || undefined}
          />
        </div>
        <SearchInput
          id="growth-entry-search"
          value={search}
          onChange={setSearch}
          placeholder="Filter by handle, brand or profile URL…"
          label="Filter accounts"
          className="min-w-[14rem] flex-1"
        />
        <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="tabular">{recordedCount}</span> of <span className="tabular">{rows.length}</span> recorded for {formatDate(date)}
        </p>
      </div>

      {futureDate && (
        <p role="alert" className="mb-3 rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[12px]">
          {formatDate(date)} has not happened yet. Pick today or an earlier date.
        </p>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No accounts to track" description="Only live accounts appear here — closed and suspended accounts are not expected to report numbers." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[60rem] border-collapse text-sm">
            <caption className="sr-only">Daily follower totals for {formatDate(date)}</caption>
            <thead className="bg-surface-2">
              <tr>
                {['Account', 'Platform', 'Sort', 'Profile URL', 'Previous total', `Total on ${formatDate(date)}`, 'Gain'].map((h, i) => (
                  <th key={h} scope="col" className={cn(
                    'border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
                    i > 3 ? 'text-right' : 'text-left',
                  )}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ account, onDate, previous }) => {
                const typed = draft[account.id];
                const value = typed ?? (onDate ? String(onDate.followerCount) : '');
                const asNumber = value.trim() === '' ? null : Number(value);
                const bad = asNumber !== null && (!Number.isInteger(asNumber) || asNumber < 0);
                const gain = asNumber !== null && previous ? asNumber - previous.followerCount : null;

                return (
                  <tr key={account.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">@{account.username}</span>
                      <span className="block text-[11px] text-muted-foreground">{lookups.brandName(account.brandId)}</span>
                    </td>
                    <td className="px-3 py-2 text-[13px]">{lookups.platformName(account.platformId)}</td>
                    <td className="px-3 py-2">
                      <Label htmlFor={`sort-${account.id}`} className="sr-only">
                        Sort market for @{account.username}
                      </Label>
                      <NativeSelect
                        id={`sort-${account.id}`}
                        value={sortOptions.some((o) => o.code === account.targetCountryCode) ? account.targetCountryCode : ''}
                        disabled={!mayEdit}
                        onChange={(e) => updateSort.mutate({
                          id: account.id, targetCountryCode: e.target.value, reason: 'Sort updated from Daily entry',
                        })}
                        className="w-32"
                      >
                        {!sortOptions.some((o) => o.code === account.targetCountryCode) && <option value="">—</option>}
                        {sortOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                      </NativeSelect>
                    </td>
                    <td className="max-w-[18rem] px-3 py-2 text-[13px]">
                      {account.profileUrl.trim() ? (
                        // Opens the real page in a new tab, to read the count from.
                        // Four rows can all say "@Lenny · Facebook"; the URL is what tells them apart.
                        <SafeExternalLink href={account.profileUrl}>{displayUrl(account.profileUrl)}</SafeExternalLink>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">No profile URL</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {previous ? (
                        <span className="flex flex-col items-end">
                          <span className="tabular">{previous.followerCount.toLocaleString()}</span>
                          <span className="text-[11px] text-muted-foreground">{formatDate(previous.date)}</span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">no history</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Label htmlFor={`count-${account.id}`} className="sr-only">
                        Follower total for @{account.username} on {formatDate(date)}
                      </Label>
                      <Input
                        id={`count-${account.id}`}
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        disabled={!mayEdit || futureDate}
                        value={value}
                        aria-invalid={bad || undefined}
                        onChange={(e) => setDraft((d) => ({ ...d, [account.id]: e.target.value }))}
                        className={cn('ml-auto w-36 text-right tabular', onDate && typed === undefined && 'border-success/50')}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {bad ? (
                        <Badge tone="danger">not a count</Badge>
                      ) : gain === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge tone={gain > 0 ? 'success' : gain < 0 ? 'danger' : 'neutral'}>
                          {gain > 0 ? '+' : ''}{gain.toLocaleString()}
                        </Badge>
                      )}
                      {onDate && typed === undefined && (
                        <span className="ml-1.5 inline-flex items-center text-[11px] text-success" title="Already recorded for this date">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          <span className="sr-only">already recorded</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Saving a date you have already filled in corrects those figures rather than adding a second entry, and the
        change is written to the audit history.
      </p>
    </SectionCard>
  );
}
