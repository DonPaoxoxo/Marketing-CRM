import * as React from 'react';
import { Bar } from 'react-chartjs-2';
import { ChartFrame, type TableView } from './ChartFrame';
import { baseBarOptions } from './setup';
import { CATEGORICAL, CHROME, MARKS } from './palette';
import { useTheme } from '@/hooks/useTheme';

export interface CategoryDatum {
  label: string;
  value: number;
  /** Optional drilldown target; rows become clickable when present. */
  href?: string;
}

/**
 * Magnitude across **nominal** categories (platforms, brands, countries).
 *
 * One series, so every bar wears the same slot-1 hue: colouring bars by their own
 * value would re-encode what bar length already shows and spend the identity
 * channel for nothing. No legend box — the title names what is plotted.
 */
export function CategoryBarChart({
  title, description, data, valueName = 'Records', onSelect, height, footnote, maxBars = 10, valueSuffix = '',
}: {
  title: string;
  description?: string;
  data: CategoryDatum[];
  valueName?: string;
  onSelect?: (datum: CategoryDatum) => void;
  height?: number;
  footnote?: React.ReactNode;
  maxBars?: number;
  /** Unit appended to the tip labels and tooltip, e.g. '%'. */
  valueSuffix?: string;
}) {
  const { resolved } = useTheme();

  // Longest bars first; anything past the cap folds into a single "Other" bar
  // rather than growing the chart without limit.
  const sorted = React.useMemo(() => [...data].sort((a, b) => b.value - a.value), [data]);
  const shown = React.useMemo<CategoryDatum[]>(() => {
    if (sorted.length <= maxBars) return sorted;
    const head = sorted.slice(0, maxBars - 1);
    const tail = sorted.slice(maxBars - 1);
    return [...head, { label: `Other (${tail.length})`, value: tail.reduce((s, d) => s + d.value, 0) }];
  }, [sorted, maxBars]);

  const series = CATEGORICAL[resolved][0];
  const chrome = CHROME[resolved];
  // Stable identity — a fresh plugin array on every render churns the chart instance.
  const tipPlugin = React.useMemo(() => [valueAtTipPlugin(chrome.muted, valueSuffix)], [chrome.muted, valueSuffix]);

  // Reserve room at the right for the tip label of the LONGEST bar. Without this
  // the widest bars run to the plot edge and lose their labels — leaving exactly
  // the biggest values unlabelled.
  const labelGutter = React.useMemo(() => {
    const widest = Math.max(0, ...shown.map((d) => `${d.value.toLocaleString()}${valueSuffix}`.length));
    return widest * 7 + 12;
  }, [shown, valueSuffix]);

  // Height must fit the bars *and* the x-axis band, or the card gets a nested scrollbar.
  const plotHeight = height ?? Math.max(140, shown.length * 30 + 44);

  const table: TableView = {
    columns: [title.replace(/^.*?by /i, '') || 'Category', valueName],
    rows: shown.map((d) => [d.label, valueSuffix ? `${d.value.toLocaleString()}${valueSuffix}` : d.value]),
  };

  return (
    <ChartFrame title={title} description={description} table={table} height={plotHeight} footnote={footnote}>
      <Bar
        key={resolved}
        aria-label={`${title}. ${shown.map((d) => `${d.label}: ${d.value}${valueSuffix}`).join('. ')}`}
        role="img"
        data={{
          labels: shown.map((d) => d.label),
          datasets: [{
            label: valueName,
            data: shown.map((d) => d.value),
            backgroundColor: series,
            hoverBackgroundColor: series,
            maxBarThickness: MARKS.maxBarThickness,
            // Leftover band width is air, not mark.
            categoryPercentage: 0.72,
            barPercentage: 0.92,
          }],
        }}
        options={(() => {
          const base = baseBarOptions(resolved, {
            horizontal: true,
            onBarClick: onSelect ? (i) => onSelect(shown[i]) : undefined,
          });
          return {
            ...base,
            layout: { padding: { top: 4, right: labelGutter, bottom: 0, left: 0 } },
            // Direct-label the value at each bar tip so the figures are readable
            // without hovering, and the axis carries the scale.
            plugins: {
              ...base.plugins,
              tooltip: {
                ...base.plugins?.tooltip,
                callbacks: { label: (ctx) => `${valueName}: ${Number(ctx.parsed.x).toLocaleString()}${valueSuffix}` },
              },
            },
          };
        })()}
        plugins={tipPlugin}
      />
    </ChartFrame>
  );
}

/** Draws the value at each bar's tip — the sparing direct label the method asks for
 *  on a single-series chart, in muted text ink rather than the series colour. */
function valueAtTipPlugin(inkColor: string, suffix = '') {
  return {
    id: 'valueAtTip',
    afterDatasetsDraw(chart: import('chart.js').Chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.font = `500 11px ${getComputedStyle(chart.canvas).fontFamily}`;
      ctx.fillStyle = inkColor;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      meta.data.forEach((bar, i) => {
        const raw = chart.data.datasets[0].data[i];
        if (typeof raw !== 'number') return;
        const { x, y } = bar.getProps(['x', 'y'], true);
        const text = `${raw.toLocaleString()}${suffix}`;
        // The layout gutter normally guarantees room; if a narrow container still
        // leaves none, drop the label rather than clip it — the value stays in
        // the tooltip and the table view, so nothing becomes unreachable.
        if (x + 6 + ctx.measureText(text).width > chart.width - 2) return;
        ctx.fillText(text, x + 6, y);
      });
      ctx.restore();
    },
  };
}
