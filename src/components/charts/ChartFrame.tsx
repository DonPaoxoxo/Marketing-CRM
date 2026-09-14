import * as React from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/bits';
import { cn } from '@/lib/cn';

export interface LegendItem {
  label: string;
  color: string;
  /** Status series carry an icon so meaning never rests on colour alone. */
  icon?: React.ReactNode;
}

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Shared chart shell.
 *
 * Two rules from the data-viz method are enforced here rather than left to each
 * caller: every chart has a **table-view twin** (so no value is reachable only by
 * hovering), and a **legend is present whenever there are two or more series**
 * (identity is never colour-alone). A single-series chart gets no legend box —
 * the title already names what is plotted.
 */
export function ChartFrame({
  title, description, legend = [], table, height = 240, footnote, children, className,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  table: TableView;
  /** Must include the x-axis band, not just the plot, or the card gets a nested scrollbar. */
  height?: number;
  footnote?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = React.useState<'chart' | 'table'>('chart');
  const titleId = React.useId();
  const isEmpty = table.rows.length === 0;

  return (
    <figure className={cn('m-0 flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <figcaption className="min-w-0">
          <h3 id={titleId} className="text-sm font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>}
        </figcaption>
        <div className="flex shrink-0 items-center gap-1 rounded-md border border-border p-0.5" role="group" aria-label={`${title} view`}>
          <Button
            size="icon-sm" variant={view === 'chart' ? 'secondary' : 'ghost'}
            aria-label="Chart view" aria-pressed={view === 'chart'}
            onClick={() => setView('chart')}
          >
            <BarChart3 />
          </Button>
          <Button
            size="icon-sm" variant={view === 'table' ? 'secondary' : 'ghost'}
            aria-label="Table view" aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            <Table2 />
          </Button>
        </div>
      </div>

      {legend.length > 1 && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label={`${title} legend`}>
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: l.color }}
                aria-hidden="true"
              />
              {l.icon && <span aria-hidden="true" className="shrink-0">{l.icon}</span>}
              <span>{l.label}</span>
            </li>
          ))}
        </ul>
      )}

      {isEmpty ? (
        <EmptyState title="Nothing to plot" description="There is nothing to chart yet. Add records, or widen the filters." />
      ) : view === 'chart' ? (
        <div style={{ height }} className="relative w-full">{children}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{title} — table view</caption>
            <thead className="bg-surface-2">
              <tr>
                {table.columns.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn(
                      'border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
                      i === 0 ? 'text-left' : 'text-right',
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={String(row[0])} className="border-b border-border last:border-0">
                  {row.map((cell, i) => (
                    <td
                      key={i}
                      className={cn('px-3 py-2', i === 0 ? 'text-left' : 'text-right tabular')}
                    >
                      {typeof cell === 'number' ? cell.toLocaleString() : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footnote && <p className="text-[11px] text-muted-foreground">{footnote}</p>}
    </figure>
  );
}
