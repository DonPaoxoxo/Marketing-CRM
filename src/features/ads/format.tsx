import { ArrowDownRight, ArrowRight, ArrowUpRight, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import { formatMoney, type CurrencyCode } from '@/lib/ads/money';
import type { TrendMetric, TrendResult } from '@/lib/ads/trends';
import type { CampaignStatus } from '@/lib/ads/campaign';
import { formatDate } from '@/lib/utils';

export const NA = 'N/A';
export const fmtCount = (n: number | null | undefined) => (n === null || n === undefined ? NA : n.toLocaleString('en-US'));
export const fmtPct = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? NA : `${n.toFixed(digits)}%`);
export const fmtCost = (n: number | null | undefined, currency: CurrencyCode) => (n === null || n === undefined ? NA : formatMoney(n, currency, { precise: true }));

export function fmtMetric(kind: TrendMetric['kind'], value: number | null, currency: CurrencyCode) {
  if (kind === 'money') return fmtCost(value, currency);
  if (kind === 'percent') return fmtPct(value);
  return fmtCount(value);
}

const STATUS_TONE: Record<CampaignStatus, React.ComponentProps<typeof Badge>['tone']> = {
  Draft: 'neutral', Scheduled: 'info', Active: 'success', Paused: 'warning', Completed: 'accent', Archived: 'danger',
};
export const CampaignStatusBadge = ({ status }: { status: CampaignStatus }) => <Badge tone={STATUS_TONE[status]}>{status}</Badge>;

/** Direction, change and interpretation — never colour alone. */
export function TrendBadge({ trend, compact = false }: { trend: ({ metric?: string } & (TrendResult | { status: 'insufficient'; reason: string })) | null; compact?: boolean }) {
  if (!trend || trend.status !== 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground" title={trend && 'reason' in trend ? trend.reason : 'No comparison available'}>
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" /> Insufficient Data
      </span>
    );
  }
  const Icon = trend.direction === 'Uptrend' ? ArrowUpRight : trend.direction === 'Downtrend' ? ArrowDownRight : ArrowRight;
  const tone = trend.interpretation === 'Improving' ? 'success' : trend.interpretation === 'Declining' ? 'danger' : 'neutral';
  const change = trend.changePct === null ? `${trend.absoluteChange >= 0 ? '+' : ''}${trend.absoluteChange.toLocaleString('en-US', { maximumFractionDigits: 2 })} (no comparable baseline)` : `${trend.changePct >= 0 ? '+' : ''}${trend.changePct.toFixed(1)}%`;
  const title = `${trend.metric ?? ''} ${trend.direction} ${change}: ${formatDate(trend.windows.current.from)}–${formatDate(trend.windows.current.to)} vs ${formatDate(trend.windows.previous.from)}–${formatDate(trend.windows.previous.to)}`;
  return (
    <span className="inline-flex flex-col gap-0.5" title={title}>
      <Badge tone={tone}><Icon className="h-3 w-3" aria-hidden="true" /> {trend.direction} {change}</Badge>
      {!compact && trend.interpretation && <span className="text-[11px] text-muted-foreground">{trend.interpretation}{trend.metric ? ` · ${trend.metric}` : ''}</span>}
    </span>
  );
}
