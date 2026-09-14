import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, Eye, EyeOff, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { NAV } from './nav';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { PageActionsProvider } from './page-actions';
import { GlobalActionsProvider, HelpButton, PageToolbar, ProfileButton, RefreshButton, ShortcutsButton, ThemeToggleButton } from './GlobalToolbar';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger, TooltipProvider,
} from '@/components/ui/overlays';
import { CONFIG, DATA_IS_EPHEMERAL } from '@/lib/config';
import { useSession } from '@/hooks/useSession';
import { ROLE_DESCRIPTIONS } from '@/lib/permissions';
import { ROLES } from '@/lib/types';
import { cn } from '@/lib/cn';

const NAV_COLLAPSED_KEY = 'mrcrm.sidebarCollapsed'; // UI preference only
const NAV_GROUPS_KEY = 'mrcrm.navGroupsClosed';     // UI preference only

function readPref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
function writePref(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function SidebarNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const { can } = useSession();
  const location = useLocation();
  const [closed, setClosed] = React.useState<string[]>(() => readPref<string[]>(NAV_GROUPS_KEY, []));
  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) }))
    .filter((g) => g.items.length);
  const toggleGroup = (label: string) => {
    setClosed((c) => {
      const next = c.includes(label) ? c.filter((l) => l !== label) : [...c, label];
      writePref(NAV_GROUPS_KEY, next);
      return next;
    });
  };
  const isCurrent = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname === to || location.pathname.startsWith(`${to}/`));

  return (
    <nav aria-label="Main" className={cn('flex flex-col py-4', collapsed ? 'gap-3 px-2' : 'gap-4 px-3')}>
      {groups.map((group) => {
        // A folded group still shows the page you are on, so you never lose your place.
        const folded = !collapsed && closed.includes(group.label);
        const items = folded ? group.items.filter((i) => isCurrent(i.to)) : group.items;
        const listId = `nav-group-${group.label.toLowerCase().replace(/\s+/g, '-')}`;
        return (
          <div key={group.label}>
            {collapsed ? (
              <div className="mx-2 mb-1.5 border-t border-border" aria-hidden="true" />
            ) : (
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={!folded}
                aria-controls={listId}
                className="flex w-full items-center justify-between rounded px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {group.label}
                <ChevronDown className={cn('h-3 w-3 transition-transform', folded && '-rotate-90')} aria-hidden="true" />
              </button>
            )}
            <ul id={listId} className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-md py-2 text-[13px] font-medium transition-colors',
                        collapsed ? 'justify-center px-0' : 'px-2',
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}



/** Contact details are masked until someone deliberately asks for them, and the
 *  ask does not survive a reload. Roles without the permission never see the control. */
function ContactRevealToggle() {
  const { showContactDetails, mayRevealContactDetails, setContactRevealed } = useSession();
  if (!mayRevealContactDetails) return null;
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-pressed={showContactDetails}
      aria-label={showContactDetails ? 'Hide contact details' : 'Show contact details'}
      title={showContactDetails
        ? 'Contact details are visible. They re-mask on reload.'
        : 'Phone numbers and emails are masked. Click to reveal.'}
      onClick={() => setContactRevealed(!showContactDetails)}
    >
      {showContactDetails ? <Eye /> : <EyeOff />}
    </Button>
  );
}

function RoleSwitcher() {
  const { role, setRole, actorName } = useSession();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <ShieldCheck />
          <span className="hidden max-w-[11rem] truncate sm:inline">{role}</span>
          <Badge tone="accent" className="hidden lg:inline-flex">preview</Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Synthetic role switching</DropdownMenuLabel>
        <p className="px-2 pb-2 text-[12px] text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{actorName}</span>. This preview changes what the
          UI offers only. Production authorization must be enforced server-side.
        </p>
        <DropdownMenuSeparator />
        {ROLES.map((r) => (
          <DropdownMenuItem key={r} onSelect={() => setRole(r)} className="flex-col items-start gap-0.5 py-2">
            <span className="flex w-full items-center justify-between font-medium">
              {r}
              {role === r && <span className="text-primary">•</span>}
            </span>
            <span className="text-[11px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** People are about to type a real register into a workspace that forgets it on
 *  reload. That has to be impossible to miss, not a footnote. */
function EphemeralDataBanner() {
  return (
    <div
      role="status"
      data-print-hide=""
      className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning-bg/60 px-3 py-1.5 sm:px-5"
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-[12px] leading-tight">
        <span className="font-semibold">Nothing you enter is saved.</span>{' '}
        There is no server yet — records live in this browser tab and are gone on reload. Use the CSV export
        before you close it.
      </p>
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const location = useLocation();
  const mainRef = React.useRef<HTMLElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => readPref<boolean>(NAV_COLLAPSED_KEY, false));
  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((v) => { writePref(NAV_COLLAPSED_KEY, !v); return !v; });
  }, []);

  React.useEffect(() => {
    setMobileOpen(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <TooltipProvider delayDuration={300}>
      <PageActionsProvider>
      <GlobalActionsProvider onToggleSidebar={toggleSidebar}>
      <div data-print-shell="" className="relative flex h-dvh overflow-hidden bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>

        {/* Persistent sidebar (desktop): full width, or an icon rail when collapsed. */}
        <aside data-print-hide="" className={cn('hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex', sidebarCollapsed ? 'w-16' : 'w-60')}>
          <div className={cn('flex h-14 items-center border-b border-border', sidebarCollapsed ? 'justify-center px-2' : 'gap-2 px-4')}>
            {!sidebarCollapsed && (
              <>
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">MR</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold leading-tight">Marketing Resource</p>
                  <p className="truncate text-[11px] leading-tight text-muted-foreground">Internal CRM</p>
                </div>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!sidebarCollapsed}
              title={`${sidebarCollapsed ? 'Expand' : 'Collapse'} sidebar (Shift + B)`}
              data-shortcut="sidebar"
            >
              {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav collapsed={sidebarCollapsed} />
          </div>
          {!sidebarCollapsed && (
            <div className="border-t border-border p-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                No live platform or vault connections. Credential secrets are never stored here.
              </p>
            </div>
          )}
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button className="absolute inset-0 bg-black/50" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface">
              <div className="flex h-14 items-center justify-between border-b border-border px-4">
                <span className="text-[13px] font-semibold">Marketing Resource</span>
                <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                  <X />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </div>
            </div>
          </div>
        )}

        <div data-print-shell="" className="flex min-w-0 flex-1 flex-col">
          <header data-print-hide="" className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-3 sm:gap-2 sm:px-5">
            <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu />
            </Button>
            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>
            <RefreshButton />
            <ContactRevealToggle />
            <NotificationBell />
            <ThemeToggleButton />
            <HelpButton />
            <ShortcutsButton />
            {/* The preview switcher is meaningless once a real session decides
                the role, so it only appears while nobody is signed in. */}
            {CONFIG.enableRolePreview && <RoleSwitcher />}
            <ProfileButton />
          </header>

          <PageToolbar />

          {DATA_IS_EPHEMERAL && <EphemeralDataBanner />}

          {/* `relative` keeps absolutely positioned descendants — screen-reader-only
              labels, above all — inside this scrolling area. Without it they are
              placed against the page itself and stretch it with empty space below. */}
          <main id="main-content" ref={mainRef} data-print-scroll="" className="relative flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[92rem] px-4 py-5 sm:px-6 sm:py-6">
              {/* Scoped to the routed view so a broken screen leaves the shell usable. */}
              <ErrorBoundary resetKey={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
      </GlobalActionsProvider>
      </PageActionsProvider>
    </TooltipProvider>
  );
}
