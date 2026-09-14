import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/primitives';

export interface KpiCardProps {
  label: string;
  value: number | string;
  /** Route + query that reproduces exactly the records counted here. */
  to?: string;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success' | 'info';
  icon?: React.ReactNode;
  loading?: boolean;
}

const TONE_RING: Record<NonNullable<KpiCardProps['tone']>, string> = {
  default: 'text-foreground',
  warning: 'text-warning',
  danger: 'text-danger',
  success: 'text-success',
  info: 'text-info',
};

export function KpiCard({ label, value, to, hint, tone = 'default', icon, loading }: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        {icon && <span className={cn('shrink-0 opacity-70', TONE_RING[tone])} aria-hidden="true">{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <p className={cn('mt-1 text-2xl font-semibold tabular tracking-tight', TONE_RING[tone])}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      {to && (
        <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          View records <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </>
  );

  const base = 'group flex flex-col rounded-lg border border-border bg-surface p-4 text-left shadow-sm transition-colors';

  if (!to) return <div className={base}>{body}</div>;
  return (
    <Link to={to} className={cn(base, 'hover:border-primary/50 hover:bg-surface-2')} aria-label={`${label}: ${value}. View matching records.`}>
      {body}
    </Link>
  );
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', className)}>{children}</div>;
}
