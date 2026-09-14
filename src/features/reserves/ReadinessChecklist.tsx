import { Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/primitives';
import type { ReadinessResult } from '@/lib/rules';
import { cn } from '@/lib/cn';

/** The readiness criteria are shown in full in the interface, never left implicit. */
export function ReadinessChecklist({ result, compact = false }: { result: ReadinessResult; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      {!compact && (
        <div className="flex items-center gap-2">
          <Badge tone={result.ready ? 'success' : 'warning'}>
            {result.ready ? 'Ready to assign' : `${result.failed.length} criterion not met`}
          </Badge>
          <span className="text-[12px] text-muted-foreground">
            An account is ready only when every criterion below passes.
          </span>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {result.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 rounded-md px-1 py-1">
            <span
              className={cn(
                'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
                c.passed ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger',
              )}
              aria-hidden="true"
            >
              {c.passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            </span>
            <span className="min-w-0 text-[13px]">
              <span className={c.passed ? '' : 'font-medium'}>{c.label}</span>
              <span className="ml-1.5 text-[12px] text-muted-foreground">— {c.detail}</span>
              <span className="sr-only">{c.passed ? ' (met)' : ' (not met)'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
