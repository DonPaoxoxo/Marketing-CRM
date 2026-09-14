import * as React from 'react';
import { Copy, FileText, Globe2, Languages, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { PLATFORM_LIMITS, formattedFor, plainText, smsInfo, type DocumentStatus, type SpielPlatform, type SpielStatus, type TargetCountry } from '@/lib/spiels';
import { cn } from '@/lib/cn';
import { copyText } from './api';

type Tone = React.ComponentProps<typeof Badge>['tone'];

const STATUS_TONE: Record<string, Tone> = {
  Draft: 'neutral', 'Pending Approval': 'warning', 'Pending Review': 'warning', Approved: 'success', Rejected: 'danger',
  'Changes Requested': 'info', Archived: 'outline', Superseded: 'outline',
};

export function SpielStatusBadge({ status }: { status: SpielStatus | DocumentStatus | string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Badge>;
}

const COUNTRY_CODE: Record<TargetCountry, string> = { India: 'IN', Indonesia: 'ID', Both: 'IN and ID', Global: 'all countries' };

/** Country, language and platform as labelled chips — never colour alone. */
export function SpielLabels({ country, language, platform, className }: { country: TargetCountry; language: string; platform?: SpielPlatform; className?: string }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
      <span className="inline-flex items-center gap-1" title="Target country"><Globe2 className="size-3" aria-hidden="true" /><span className="sr-only">Country: </span>{country === 'Both' ? 'India + Indonesia' : country}<span className="sr-only"> ({COUNTRY_CODE[country]})</span></span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1" title="Language"><Languages className="size-3" aria-hidden="true" /><span className="sr-only">Language: </span>{language}</span>
      {platform && <>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1" title="Platform"><MessageSquare className="size-3" aria-hidden="true" /><span className="sr-only">Platform: </span>{platform}</span>
      </>}
    </span>
  );
}

/** Characters (and SMS segments) with the platform's soft limit. */
export function CharacterCount({ text, platform }: { text: string; platform: SpielPlatform }) {
  const limit = PLATFORM_LIMITS[platform];
  if (platform === 'SMS') {
    const info = smsInfo(text);
    return (
      <span className={cn('text-[12px] tabular', info.segments > 1 ? 'text-warning' : 'text-muted-foreground')} aria-live="polite">
        {info.characters} characters · {info.encoding} · {info.segments} SMS {info.segments === 1 ? 'segment' : 'segments'} ({info.perSegment} per segment)
      </span>
    );
  }
  const n = [...text].length;
  return (
    <span className={cn('text-[12px] tabular', limit && n > limit ? 'text-danger' : 'text-muted-foreground')} aria-live="polite">
      {n.toLocaleString()} characters{limit ? ` of ${limit.toLocaleString()} for ${platform}` : ''}
    </span>
  );
}

/** How the script will look when pasted into the platform. */
export function PlatformPreview({ text, platform }: { text: string; platform: SpielPlatform }) {
  const formatted = formattedFor(platform, text);
  const chat = platform === 'WhatsApp' || platform === 'Telegram' || platform === 'SMS' || platform === 'Facebook';
  const html = React.useMemo(() => {
    const escaped = formatted.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return platform === 'WhatsApp' || platform === 'Telegram' ? escaped.replace(/\*(\S(?:.*?\S)?)\*/g, '<strong>$1</strong>').replace(/_(\S(?:.*?\S)?)_/g, '<em>$1</em>') : escaped;
  }, [formatted, platform]);
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>{platform} preview</span>
        <CharacterCount text={formatted} platform={platform} />
      </figcaption>
      <div className={cn('rounded-lg border border-border p-3 text-[13px] leading-relaxed', chat ? 'bg-success-bg/40' : 'bg-surface-2')}>
        {/* Escaped above; only bold and italic markers become tags. */}
        <p className={cn('whitespace-pre-wrap break-words', chat && 'max-w-[85%] rounded-lg rounded-tl-none bg-surface px-3 py-2 shadow-sm')} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </figure>
  );
}

export function CopyButtons({ text, platform, onCopied, compact }: { text: string; platform: SpielPlatform; onCopied?: () => void; compact?: boolean }) {
  const copy = async (value: string, label: string) => {
    if (await copyText(value)) {
      toast.success(`${label} copied to clipboard`);
      onCopied?.();
    } else {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  };
  if (compact) {
    return (
      <Button size="sm" variant="outline" onClick={() => copy(formattedFor(platform, text), 'Spiel')}>
        <Copy /> Copy
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => copy(formattedFor(platform, text), `Formatted ${platform} version`)}><Copy /> Copy formatted</Button>
      <Button size="sm" variant="outline" onClick={() => copy(plainText(text), 'Plain-text version')}><FileText /> Copy plain text</Button>
    </div>
  );
}
