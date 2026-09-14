import * as React from 'react';
import { Bar } from 'react-chartjs-2';
import { ChartFrame, type LegendItem, type TableView } from './ChartFrame';
import { baseBarOptions } from './setup';
import { CATEGORICAL, CHROME, MARKS, SERIES_CAP, STATUS } from './palette';
import { useTheme } from '@/hooks/useTheme';

export interface StackSeries {
  label: string;
  values: number[];
  /** Set when the series *means* good/bad — it then wears status tokens, never a
   *  categorical slot, and its legend entry carries an icon. */
  status?: keyof (typeof STATUS)['light'];
  icon?: React.ReactNode;
}

/**
 * Part-to-whole across a few rows (allocation states, expiry buckets).
 *
 * Horizontal so long category names have room. Segments are separated by a 2px
 * gap in the surface colour — never by a stroke drawn around the mark.
 */
export function StackedBarChart({
  title, description, rows, series, height, footnote, valueName = 'Records', showPercent = false,
}: {
  title: string;
  description?: string;
  /** One label per bar. */
  rows: string[];
  series: StackSeries[];
  height?: number;
  footnote?: React.ReactNode;
  valueName?: string;
  showPercent?: boolean;
}) {
  const { resolved } = useTheme();
  const chrome = CHROME[resolved];

  if (series.length > SERIES_CAP.adjacent) {
    // Guard rather than silently cycling hues — a generated 7th colour is
    // indistinguishable from an existing slot under CVD.
    throw new Error(
      `StackedBarChart: ${series.length} series exceeds the ${SERIES_CAP.adjacent}-slot cap. Fold the tail into "Other" or facet.`,
    );
  }

  const colorFor = (s: StackSeries, i: number) =>
    s.status ? STATUS[resolved][s.status] : CATEGORICAL[resolved][i];

  const totals = rows.map((_, r) => series.reduce((sum, s) => sum + (s.values[r] ?? 0), 0));

  const legend: LegendItem[] = series.map((s, i) => ({
    label: s.label,
    color: colorFor(s, i),
    icon: s.icon,
  }));

  const table: TableView = {
    columns: ['', ...series.map((s) => s.label), 'Total'],
    rows: rows.map((label, r) => [
      label,
      ...series.map((s) => s.values[r] ?? 0),
      totals[r],
    ]),
  };

  const plotHeight = height ?? Math.max(130, rows.length * 46 + 44);
  const base = baseBarOptions(resolved, { horizontal: true, stacked: true });

  return (
    <ChartFrame
      title={title}
      description={description}
      legend={legend}
      table={table}
      height={plotHeight}
      footnote={footnote}
    >
      <Bar
        key={resolved}
        role="img"
        aria-label={`${title}. ${rows
          .map((r, i) => `${r}: ${series.map((s) => `${s.label} ${s.values[i] ?? 0}`).join(', ')}`)
          .join('. ')}`}
        data={{
          labels: rows,
          datasets: series.map((s, i) => ({
            label: s.label,
            data: s.values,
            backgroundColor: colorFor(s, i),
            hoverBackgroundColor: colorFor(s, i),
            // The 2px surface-coloured gap between touching segments. The last
            // segment carries none, so the bar's data-end stays at its true length.
            borderColor: chrome.surface,
            borderWidth: i === series.length - 1
              ? 0
              : { top: 0, bottom: 0, left: 0, right: MARKS.surfaceGap },
            borderSkipped: false,
            borderRadius: i === series.length - 1 ? MARKS.dataEndRadius : 0,
            maxBarThickness: MARKS.maxBarThickness,
            categoryPercentage: 0.7,
            barPercentage: 0.9,
          })),
        }}
        options={{
          ...base,
          plugins: {
            ...base.plugins,
            tooltip: {
              ...base.plugins?.tooltip,
              callbacks: {
                label: (ctx) => {
                  const v = Number(ctx.parsed.x ?? 0);
                  const total = totals[ctx.dataIndex] || 1;
                  const pct = showPercent ? ` (${Math.round((v / total) * 100)}%)` : '';
                  return `${ctx.dataset.label}: ${v.toLocaleString()}${pct}`;
                },
                footer: (items) =>
                  items.length ? `${valueName} total: ${totals[items[0].dataIndex].toLocaleString()}` : '',
              },
              footerColor: chrome.muted,
              footerFont: { weight: 400, size: 11 },
            },
          },
        }}
      />
    </ChartFrame>
  );
}
