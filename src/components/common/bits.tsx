import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Inbox, Lock, ShieldAlert } from 'lucide-react';
import { Badge, Card, Separator } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { isSafeUrl } from '@/lib/sanitize';
import type {
  AccountAllocationStatus, AccountOperationalStatus, AllocationStatus,
  CooperationStatus, CredentialAccessStatus, DomainStatus, HandoverStatus, SimOperationalStatus,
} from '@/lib/types';

/* ── Page scaffolding ─────────────────────────────────────────── */

export function PageHeader({
  title, description, actions, children,
}: { title: string; description?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function SectionCard({
  title, description, actions, children, className,
}: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <Inbox className="mb-2 h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-md text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-lg border border-danger/40 bg-danger-bg/40 px-6 py-10 text-center">
      <AlertTriangle className="mb-2 h-7 w-7 text-danger" aria-hidden="true" />
      <p className="text-sm font-medium text-danger">Something went wrong</p>
      <p className="mt-1 max-w-md text-[13px] text-muted-foreground">{message}</p>
      {onRetry && <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Key/value grid used on every detail page. */
export function DefinitionList({ items, columns = 2 }: { items: { label: string; value: React.ReactNode; hint?: string }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }[columns])}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{it.label}</dt>
          <dd className="mt-1 break-words text-[13px]">{it.value}</dd>
          {it.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{it.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

/** Standing notice wherever the UI would imply a live integration. */
export function NotConnectedNotice({ what, className }: { what: string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-md border border-warning/40 bg-warning-bg/50 px-3 py-2', className)}>
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-[12px] text-foreground/90">
        <span className="font-semibold">Not connected.</span> {what}
      </p>
    </div>
  );
}

export function SecurityNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-info/40 bg-info-bg/50 px-3 py-2">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
      <p className="text-[12px] text-foreground/90">{children}</p>
    </div>
  );
}

export function RecordLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>
      {children}
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );
}

/** An outbound link that refuses to render as a link unless the URL is safe.
 *
 *  The API already drops dangerous schemes before storing them; this is the second
 *  line, covering records written before that guard existed or by a future path
 *  that forgets it. An unsafe value is shown as plain text so the operator can
 *  still see what is stored, and can tell it was refused. */
export function SafeExternalLink({ href, children, className }: { href: string; children?: React.ReactNode; className?: string }) {
  const label = children ?? href;
  if (!isSafeUrl(href)) {
    return (
      <span className={cn('inline-flex items-center gap-1 break-all text-muted-foreground', className)}>
        {label}
        <Badge tone="danger">unsafe link</Badge>
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener external"
      className={cn('inline-flex items-center gap-1 break-all text-primary hover:underline', className)}
    >
      {label}
      <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

export function Measured({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="text-[11px] text-muted-foreground">not measured</span>;
  return <span className="text-[11px] text-muted-foreground">measured {new Date(date).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })}</span>;
}

export { Separator };

/* ── Status badges ────────────────────────────────────────────── */

type Tone = React.ComponentProps<typeof Badge>['tone'];

const SIM_OP_TONE: Record<SimOperationalStatus, Tone> = {
  Active: 'success', Inactive: 'neutral', Lost: 'danger', Expired: 'warning', Retired: 'neutral',
};
const ALLOC_TONE: Record<AllocationStatus, Tone> = { Available: 'info', Reserved: 'accent', Assigned: 'success' };
const ACC_ALLOC_TONE: Record<AccountAllocationStatus, Tone> = { Unassigned: 'info', Reserved: 'accent', Assigned: 'success' };
const ACC_OP_TONE: Record<AccountOperationalStatus, Tone> = {
  Active: 'success', 'Under Review': 'warning', Restricted: 'danger', Suspended: 'danger', Closed: 'neutral',
};
const COOP_TONE: Record<CooperationStatus, Tone> = {
  Prospect: 'info', Onboarding: 'accent', Active: 'success', Paused: 'warning', Ended: 'neutral',
};
const HANDOVER_TONE: Record<HandoverStatus, Tone> = {
  Pending: 'warning', 'In Progress': 'info', Acknowledged: 'success', Completed: 'success', Returned: 'neutral', Cancelled: 'neutral',
};
const CRED_TONE: Record<CredentialAccessStatus, Tone> = {
  'Not Requested': 'neutral', Requested: 'warning', Approved: 'success', Revoked: 'danger', Expired: 'danger',
};
const DOMAIN_TONE: Record<DomainStatus, Tone> = { Active: 'success', Inactive: 'neutral' };

const TONE_MAPS: Record<string, Record<string, Tone>> = {
  simOperational: SIM_OP_TONE,
  allocation: ALLOC_TONE,
  accountAllocation: ACC_ALLOC_TONE,
  accountOperational: ACC_OP_TONE,
  cooperation: COOP_TONE,
  handover: HANDOVER_TONE,
  credential: CRED_TONE,
  domain: DOMAIN_TONE,
};

export function StatusBadge({ kind, value }: { kind: keyof typeof TONE_MAPS; value: string }) {
  const tone = TONE_MAPS[kind]?.[value] ?? 'neutral';
  return <Badge tone={tone}>{value}</Badge>;
}
