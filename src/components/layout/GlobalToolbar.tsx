/** The global buttons: in the header (refresh, notifications, theme, help,
 *  shortcuts, profile) and on the page toolbar (filter, clear filters, save view,
 *  export, print, copy link, share, full screen), plus the keyboard shortcuts
 *  that trigger the same actions. */

import * as React from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown, CircleHelp, Copy, Download, Expand, FileSpreadsheet, FileText, Filter, FilterX, Keyboard, LogOut,
  Mail, Minimize, Moon, MoreHorizontal, Printer, RefreshCw, Share2, Star, Sun, UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input, Label } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { ExportDialog, type ExportFormat } from '@/components/common/ExportDialog';
import { SavedViews } from '@/components/common/SavedViews';
import { useAuth } from '@/hooks/useAuth';
import { useSession } from '@/hooks/useSession';
import { useTheme } from '@/hooks/useTheme';
import { PERMISSION_LABELS, ROLE_DESCRIPTIONS } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import { printPage } from '@/lib/print';
import { ALL_NAV_ITEMS, type NavItem } from './nav';
import { usePageActions } from './page-actions';

/* ── Shortcuts ─────────────────────────────────────────────────── */

export type GlobalActionId =
  | 'search' | 'shortcuts' | 'refresh' | 'filter' | 'clear-filters' | 'save-view' | 'export' | 'print' | 'copy-link'
  | 'share' | 'fullscreen' | 'theme' | 'notifications' | 'help' | 'profile' | 'sidebar';

export const SHORTCUTS: { id: GlobalActionId; label: string; keys: string[] }[] = [
  { id: 'search', label: 'Search', keys: ['Ctrl / ⌘ + K', '/'] },
  { id: 'sidebar', label: 'Collapse or expand the sidebar', keys: ['Shift + B'] },
  { id: 'refresh', label: 'Refresh data', keys: ['Shift + R'] },
  { id: 'filter', label: 'Filter (jump to the page filters)', keys: ['Shift + F'] },
  { id: 'clear-filters', label: 'Clear filters', keys: ['Shift + X'] },
  { id: 'save-view', label: 'Save view', keys: ['Shift + S'] },
  { id: 'export', label: 'Export (CSV, Excel or PDF)', keys: ['Shift + E'] },
  { id: 'print', label: 'Print page', keys: ['Shift + P'] },
  { id: 'copy-link', label: 'Copy link', keys: ['Shift + L'] },
  { id: 'share', label: 'Share report', keys: ['Shift + O'] },
  { id: 'fullscreen', label: 'Full-screen view', keys: ['Shift + M'] },
  { id: 'theme', label: 'Toggle light/dark mode', keys: ['Shift + D'] },
  { id: 'notifications', label: 'Notifications', keys: ['Shift + N'] },
  { id: 'help', label: 'Help', keys: ['Shift + H'] },
  { id: 'profile', label: 'User profile', keys: ['Shift + U'] },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: ['?'] },
];

const SHIFT_KEYS: Record<string, GlobalActionId> = {
  R: 'refresh', F: 'filter', X: 'clear-filters', S: 'save-view', E: 'export', P: 'print', L: 'copy-link',
  O: 'share', M: 'fullscreen', D: 'theme', N: 'notifications', H: 'help', U: 'profile', B: 'sidebar',
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable));
};

/** Which global action a key press means, or null. Exported for tests. */
export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>): GlobalActionId | null {
  if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === '?') return 'shortcuts';
  if (e.shiftKey && e.key.length === 1) return SHIFT_KEYS[e.key.toUpperCase()] ?? null;
  return null;
}

/* ── Shared state for the buttons and the shortcuts ────────────── */

interface GlobalActions {
  run: (id: GlobalActionId) => void;
  page: NavItem | undefined;
  fullscreen: boolean;
  refreshing: boolean;
  exportCount: number;
  filtersActive: number;
  hasFilters: boolean;
  openExport: (format: ExportFormat) => void;
}

const GlobalActionsContext = React.createContext<GlobalActions | null>(null);
const useGlobalActions = () => {
  const ctx = React.useContext(GlobalActionsContext);
  if (!ctx) throw new Error('GlobalActionsProvider is missing');
  return ctx;
};

export function currentNavItem(pathname: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((n) => (n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(`${n.to}/`)));
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  }
}

export function GlobalActionsProvider({ children, onToggleSidebar }: { children: React.ReactNode; onToggleSidebar?: () => void }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toggle } = useTheme();
  const { exportSources, filterSource } = usePageActions();
  const refreshing = useIsFetching() > 0;
  const page = currentNavItem(location.pathname);
  const [fullscreen, setFullscreen] = React.useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const [exportState, setExportState] = React.useState<{ open: boolean; format: ExportFormat }>({ open: false, format: 'csv' });
  const [dialog, setDialog] = React.useState<'help' | 'shortcuts' | 'profile' | 'share' | null>(null);
  const [saveViewOpen, setSaveViewOpen] = React.useState(false);

  React.useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const pageTitle = page?.label ?? 'Marketing Resource CRM';

  const run = React.useCallback((id: GlobalActionId) => {
    switch (id) {
      case 'search':
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
        break;
      case 'refresh':
        void queryClient.invalidateQueries().then(() => toast.success('Data refreshed'));
        break;
      case 'filter': {
        const bar = filterSource?.elementRef.current ?? document.querySelector<HTMLElement>('[data-filter-bar]');
        if (!bar) { toast.info('This page has no filters.'); break; }
        bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bar.querySelector<HTMLElement>('input, select, button:not([disabled])')?.focus();
        break;
      }
      case 'clear-filters':
        if (filterSource && filterSource.activeCount > 0) { filterSource.clear(); toast.success('Filters cleared'); } else toast.info('No filters are active.');
        break;
      case 'save-view':
        setSaveViewOpen(true);
        break;
      case 'export':
        setExportState({ open: true, format: 'csv' });
        break;
      case 'print':
        printPage();
        break;
      case 'copy-link':
        void copyToClipboard(window.location.href).then((ok) => (ok ? toast.success('Link copied', { description: 'It keeps this page and its filters. People still need to sign in and have access.' }) : toast.error('Could not copy the link.')));
        break;
      case 'share': {
        const data = { title: `${pageTitle} — Marketing Resource CRM`, text: `${pageTitle} in the Marketing Resource CRM`, url: window.location.href };
        if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
          navigator.share(data).catch((e: Error) => { if (e.name !== 'AbortError') setDialog('share'); });
        } else {
          setDialog('share');
        }
        break;
      }
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen?.();
        else if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => toast.error('Full-screen view is not available here.'));
        else toast.error('Full-screen view is not supported by this browser.');
        break;
      case 'theme':
        toggle();
        break;
      case 'sidebar':
        onToggleSidebar?.();
        break;
      case 'notifications':
        document.querySelector<HTMLElement>('[data-shortcut="notifications"]')?.click();
        break;
      case 'help':
      case 'shortcuts':
      case 'profile':
        setDialog(id);
        break;
    }
  }, [queryClient, filterSource, pageTitle, toggle, onToggleSidebar]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = shortcutFor(e);
      // Leave shortcuts alone while a dialog or menu has focus.
      if (!id || document.querySelector('[role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      run(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const value: GlobalActions = {
    run, page, fullscreen, refreshing,
    exportCount: exportSources.length, filtersActive: filterSource?.activeCount ?? 0, hasFilters: Boolean(filterSource),
    openExport: (format) => setExportState({ open: true, format }),
  };

  return (
    <GlobalActionsContext.Provider value={value}>
      {children}
      {exportState.open && (
        <ExportDialog open onOpenChange={(open) => setExportState((s) => ({ ...s, open }))} sources={exportSources} initialFormat={exportState.format} />
      )}
      <SaveViewDialog open={saveViewOpen} onOpenChange={setSaveViewOpen} />
      <HelpDialog open={dialog === 'help'} onOpenChange={(v) => setDialog(v ? 'help' : null)} page={page} onShortcuts={() => setDialog('shortcuts')} />
      <ShortcutsDialog open={dialog === 'shortcuts'} onOpenChange={(v) => setDialog(v ? 'shortcuts' : null)} />
      <ProfileDialog open={dialog === 'profile'} onOpenChange={(v) => setDialog(v ? 'profile' : null)} />
      <ShareDialog open={dialog === 'share'} onOpenChange={(v) => setDialog(v ? 'share' : null)} title={pageTitle} />
    </GlobalActionsContext.Provider>
  );
}

/* ── Header buttons ────────────────────────────────────────────── */

function IconAction({ id, label, icon: Icon, onClick, disabled, pressed, className, spin }: {
  id: GlobalActionId; label: string; icon: typeof RefreshCw; onClick: () => void; disabled?: boolean; pressed?: boolean; className?: string; spin?: boolean;
}) {
  const hint = SHORTCUTS.find((s) => s.id === id)?.keys.join(' or ');
  return (
    <Button variant="ghost" size="icon-sm" data-shortcut={id} aria-label={label} title={hint ? `${label} (${hint})` : label}
      aria-pressed={pressed} onClick={onClick} disabled={disabled} className={className}>
      <Icon className={spin ? 'animate-spin' : undefined} />
    </Button>
  );
}

export function RefreshButton() {
  const { run, refreshing } = useGlobalActions();
  return <IconAction id="refresh" label="Refresh data" icon={RefreshCw} onClick={() => run('refresh')} spin={refreshing} className="hidden sm:inline-flex" />;
}

export function ThemeToggleButton() {
  const { resolved } = useTheme();
  const { run } = useGlobalActions();
  return <IconAction id="theme" label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} icon={resolved === 'dark' ? Sun : Moon} onClick={() => run('theme')} className="hidden sm:inline-flex" />;
}

export function HelpButton() {
  const { run } = useGlobalActions();
  return <IconAction id="help" label="Help" icon={CircleHelp} onClick={() => run('help')} className="hidden sm:inline-flex" />;
}

export function ShortcutsButton() {
  const { run } = useGlobalActions();
  return <IconAction id="shortcuts" label="Keyboard shortcuts" icon={Keyboard} onClick={() => run('shortcuts')} className="hidden sm:inline-flex" />;
}

export function ProfileButton() {
  const { user, status, signOut } = useAuth();
  const { role, actorName } = useSession();
  const { run } = useGlobalActions();
  const { resolved } = useTheme();
  const navigate = useNavigate();
  const name = user?.name ?? actorName;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" data-shortcut="profile" aria-label={`User profile: ${name}`}>
          <UserRound />
          <span className="hidden max-w-[10rem] truncate md:inline">{name}</span>
          <ChevronDown className="hidden size-3 md:inline" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{status === 'authenticated' ? 'Signed in' : 'Preview'}</DropdownMenuLabel>
        <div className="px-2 pb-2">
          <p className="truncate text-[13px] font-medium">{name}</p>
          {user?.email && <p className="truncate text-[12px] text-muted-foreground">{user.email}</p>}
          <Badge tone="accent" className="mt-1.5">{user?.role ?? role}</Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => run('profile')}><UserRound className="h-3.5 w-3.5" /> My profile</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('theme')}>{resolved === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />} {resolved === 'dark' ? 'Light mode' : 'Dark mode'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('shortcuts')}><Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('help')}><CircleHelp className="h-3.5 w-3.5" /> Help</DropdownMenuItem>
        {status === 'authenticated' && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={async () => { await signOut(); navigate('/login', { replace: true }); }}><LogOut className="h-3.5 w-3.5" /> Sign out</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Page toolbar ──────────────────────────────────────────────── */

export function PageToolbar() {
  const a = useGlobalActions();
  const { can } = useSession();
  const exportReason = !can('export:data') ? 'Your role cannot export data.' : a.exportCount === 0 ? 'This page has no table to export.' : undefined;
  const filterReason = a.hasFilters ? undefined : 'This page has no filters.';

  const items: { id: GlobalActionId | `export-${ExportFormat}`; label: string; icon: typeof Filter; onClick: () => void; disabled?: string; pressed?: boolean }[] = [
    { id: 'filter', label: 'Filter', icon: Filter, onClick: () => a.run('filter'), disabled: filterReason },
    { id: 'clear-filters', label: a.filtersActive ? `Clear filters (${a.filtersActive})` : 'Clear filters', icon: FilterX, onClick: () => a.run('clear-filters'), disabled: filterReason ?? (a.filtersActive ? undefined : 'No filters are active.') },
    { id: 'export-csv', label: 'Export CSV', icon: FileText, onClick: () => a.openExport('csv'), disabled: exportReason },
    { id: 'export-excel', label: 'Export Excel', icon: FileSpreadsheet, onClick: () => a.openExport('excel'), disabled: exportReason },
    { id: 'export-pdf', label: 'Export PDF', icon: Download, onClick: () => a.openExport('pdf'), disabled: exportReason },
    { id: 'print', label: 'Print page', icon: Printer, onClick: () => a.run('print') },
    { id: 'copy-link', label: 'Copy link', icon: Copy, onClick: () => a.run('copy-link') },
    { id: 'share', label: 'Share report', icon: Share2, onClick: () => a.run('share') },
    { id: 'fullscreen', label: a.fullscreen ? 'Exit full screen' : 'Full-screen view', icon: a.fullscreen ? Minimize : Expand, onClick: () => a.run('fullscreen'), pressed: a.fullscreen },
  ];
  const hint = (id: string) => SHORTCUTS.find((s) => s.id === (id.startsWith('export') ? 'export' : id))?.keys.join(' or ');

  return (
    <div data-print-hide="" className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border bg-surface/80 px-3 py-1 sm:px-5" role="toolbar" aria-label="Page actions">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{a.page?.label ?? 'Marketing Resource CRM'}</p>
      </div>
      <div className="hidden items-center gap-0.5 md:flex">
        {items.slice(0, 2).map((i) => <ToolbarButton key={i.id} {...i} hint={hint(i.id)} />)}
        <SavedViews compact />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={Boolean(exportReason)} title={exportReason ?? 'Export (Shift + E)'} data-shortcut="export">
              <Download /> <span className="hidden xl:inline">Export</span> <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.slice(2, 5).map((i) => (
              <DropdownMenuItem key={i.id} onSelect={i.onClick}><i.icon className="h-3.5 w-3.5" /> {i.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {items.slice(5).map((i) => <ToolbarButton key={i.id} {...i} hint={hint(i.id)} />)}
      </div>
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Page actions"><MoreHorizontal /> Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {items.map((i) => (
              <DropdownMenuItem key={i.id} disabled={Boolean(i.disabled)} onSelect={i.onClick}><i.icon className="h-3.5 w-3.5" /> {i.label}</DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => a.run('save-view')}><Star className="h-3.5 w-3.5" /> Save view</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => a.run('refresh')}><RefreshCw className="h-3.5 w-3.5" /> Refresh data</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => a.run('help')}><CircleHelp className="h-3.5 w-3.5" /> Help</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ToolbarButton({ id, label, icon: Icon, onClick, disabled, pressed, hint }: { id: string; label: string; icon: typeof Filter; onClick: () => void; disabled?: string; pressed?: boolean; hint?: string }) {
  return (
    <Button variant="ghost" size="sm" data-shortcut={id} onClick={onClick} disabled={Boolean(disabled)} aria-pressed={pressed}
      aria-label={label} title={disabled ?? (hint ? `${label} (${hint})` : label)} className="px-2">
      <Icon /> <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}

/* ── Dialogs ───────────────────────────────────────────────────── */

function SaveViewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>Saves this page with its current filters so you can come back to it. Views are kept in this browser only.</DialogDescription>
        </DialogHeader>
        <SavedViews inline onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const PAGE_TIPS: Record<string, string[]> = {
  '/': ['KPIs are counted from the same records as the registers, so a number always matches the list it opens.', 'Click a KPI to open the filtered records behind it.'],
  '/sims': ['Filter by country, provider or status; the filters stay in the link.', 'Bulk upload SIMs from the sheet template. Rows with problems are shown before anything is saved.'],
  '/agents': ['Only the assigned manager or the System Administrator edits an agent; any member who may archive can archive or restore.', 'Switch between Active and Archived above the table.'],
  '/accounts': ['Follower counts are typed in and dated — nothing syncs live from the platforms.'],
  '/domains': ['Expired and soon-to-expire domains are highlighted without changing their status.', 'Use Bulk upload for the registrar export.'],
  '/shared-spiel': ['Only approved spiels are shared. Drafts stay private to you and the System Administrator.', 'Use the AI Assistant Learner to improve a draft; review every suggestion before submitting.'],
  '/team-reports': ['Pick Daily, Weekly or Monthly, write your report and attach files (images under 1 MB).'],
  '/ads-monitoring': ['Only the person who created a record, or the System Owner, can change it.'],
  '/reports': ['Each report has its own export; the toolbar export lets you choose which table.'],
};

function HelpDialog({ open, onOpenChange, page, onShortcuts }: { open: boolean; onOpenChange: (v: boolean) => void; page?: NavItem; onShortcuts: () => void }) {
  const tips = page ? PAGE_TIPS[page.to] ?? [] : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Help{page ? ` — ${page.label}` : ''}</DialogTitle>
          <DialogDescription>{page?.description ?? 'Internal Marketing Resource CRM.'}</DialogDescription>
        </DialogHeader>
        {tips.length > 0 && (
          <section>
            <h3 className="mb-1 text-[13px] font-semibold">On this page</h3>
            <ul className="ml-4 list-disc text-[13px]">{tips.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        )}
        <section>
          <h3 className="mb-1 text-[13px] font-semibold">Global buttons</h3>
          <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[10rem_1fr]">
            {[
              ['Refresh data', 'Reloads everything from the server without losing your filters.'],
              ['Search', 'Finds records, people and pages you are allowed to see.'],
              ['Filter / Clear filters', 'Jumps to the page filters, or resets them.'],
              ['Save view', 'Remembers this page with its filters, in this browser.'],
              ['Export CSV / Excel / PDF', 'Exports the filtered table. Needs the export permission; contact details stay masked unless you include them; every export is audited.'],
              ['Print page', 'Prints the page without the navigation.'],
              ['Copy link / Share report', 'Shares a link to this exact view. People still need to sign in and have access — a link is not a permission.'],
              ['Full-screen view', 'Hides the browser around the CRM. Press Esc to leave.'],
              ['Notifications', 'Reviews, approvals and replies that concern you.'],
              ['User profile', 'Your role, permissions and password.'],
            ].map(([k, v]) => <React.Fragment key={k}><dt className="font-medium">{k}</dt><dd className="text-muted-foreground">{v}</dd></React.Fragment>)}
          </dl>
        </section>
        <p className="text-[12px] text-muted-foreground">Missing access to a page or action? Ask your System Administrator — roles and permissions are managed in Roles &amp; Audit.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onShortcuts}><Keyboard /> Keyboard shortcuts</Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts work anywhere except while you are typing in a field.</DialogDescription>
        </DialogHeader>
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-border">
            {SHORTCUTS.map((s) => (
              <tr key={s.id}>
                <td className="py-1.5 pr-3">{s.label}</td>
                <td className="py-1.5 text-right">{s.keys.map((k, i) => <React.Fragment key={k}>{i > 0 && <span className="px-1 text-muted-foreground">or</span>}<kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">{k}</kbd></React.Fragment>)}</td>
              </tr>
            ))}
            <tr><td className="py-1.5 pr-3">Close a dialog or menu</td><td className="py-1.5 text-right"><kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">Esc</kbd></td></tr>
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ open, onOpenChange, title }: { open: boolean; onOpenChange: (v: boolean) => void; title: string }) {
  const url = typeof window === 'undefined' ? '' : window.location.href;
  const mail = `mailto:?subject=${encodeURIComponent(`${title} — Marketing Resource CRM`)}&body=${encodeURIComponent(`${title}:\n${url}\n\nSign in to the CRM to open it.`)}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Share report</DialogTitle>
          <DialogDescription>Share a link to this page with its filters. Only signed-in people with access can open it.</DialogDescription>
        </DialogHeader>
        <Label htmlFor="share-link">Link</Label>
        <Input id="share-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <DialogFooter>
          <Button variant="outline" asChild><a href={mail}><Mail /> Email link</a></Button>
          <Button onClick={async () => { if (await copyToClipboard(url)) { toast.success('Link copied'); onOpenChange(false); } }}><Copy /> Copy link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user, status } = useAuth();
  const { role, actorName, permissions, can } = useSession();
  const { theme, setTheme } = useTheme();
  const effectiveRole = user?.role ?? role;
  const granted = (Object.keys(PERMISSION_LABELS) as (keyof typeof PERMISSION_LABELS)[]).filter((p) => (permissions ? permissions.includes(p) : can(p)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>My profile</DialogTitle>
          <DialogDescription>{status === 'authenticated' ? 'Your account in the CRM.' : 'Preview role — no one is signed in.'}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-[13px]">
          <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{user?.name ?? actorName}</dd>
          {user?.email && <><dt className="text-muted-foreground">Email</dt><dd>{user.email}</dd></>}
          <dt className="text-muted-foreground">Role</dt><dd><Badge tone="accent">{effectiveRole}</Badge><p className="mt-1 text-[12px] text-muted-foreground">{ROLE_DESCRIPTIONS[effectiveRole]}</p></dd>
        </dl>
        <section>
          <h3 className="mb-1 text-[13px] font-semibold">What you can do</h3>
          {granted.length ? (
            <ul className="flex flex-wrap gap-1">{granted.map((p) => <li key={p}><Badge tone="neutral">{PERMISSION_LABELS[p]}</Badge></li>)}</ul>
          ) : <p className="text-[12px] text-muted-foreground">Read-only access.</p>}
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold">Appearance</h3>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Theme">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <Button key={t} size="sm" variant={theme === t ? 'default' : 'outline'} role="radio" aria-checked={theme === t} onClick={() => setTheme(t)} className="capitalize">{t}</Button>
            ))}
          </div>
        </section>
        {status === 'authenticated' && <ChangePassword email={user?.email ?? ''} />}
      </DialogContent>
    </Dialog>
  );
}

function ChangePassword({ email }: { email: string }) {
  const [form, setForm] = React.useState({ current: '', next: '', confirm: '' });
  const [error, setError] = React.useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) { setError({ field: 'confirm', message: 'The new passwords do not match.' }); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/change-password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }) });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { setError({ field: payload.field === 'newPassword' ? 'next' : 'current', message: payload.message ?? 'Could not change the password.' }); return; }
      // Passwords live only in this form's memory and are cleared straight away.
      setForm({ current: '', next: '', confirm: '' });
      toast.success('Password changed', { description: 'Every other device has been signed out.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-[13px] font-semibold">Change password</h3>
      {/* Lets password managers attach the new password to the right account. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <Field label="Current password" htmlFor="pw-current" error={error?.field === 'current' ? error.message : undefined}>
        <Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
      </Field>
      <Field label="New password" htmlFor="pw-next" error={error?.field === 'next' ? error.message : undefined} hint="At least 12 characters, not your name or email.">
        <Input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
      </Field>
      <Field label="Confirm new password" htmlFor="pw-confirm" error={error?.field === 'confirm' ? error.message : undefined}>
        <Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
      </Field>
      <Button type="submit" size="sm" className={cn('self-start')} disabled={busy || !form.current || !form.next || !form.confirm}>{busy ? 'Changing…' : 'Change password'}</Button>
    </form>
  );
}
