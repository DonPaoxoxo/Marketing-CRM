/** Chart.js registration and the shared option defaults every chart inherits.
 *  Registered explicitly (rather than `Chart.register(...registerables)`) so the
 *  bundle only carries the controllers this app actually draws. */

import {
  BarController, BarElement, CategoryScale, Chart, Legend, LineController, LineElement,
  LinearScale, PointElement, Tooltip, type ChartOptions,
} from 'chart.js';
import { CHART_FONT, CHROME, MARKS, type Mode } from './palette';

Chart.register(
  BarController, BarElement, LineController, LineElement, PointElement,
  CategoryScale, LinearScale, Tooltip, Legend,
);

Chart.defaults.font.family = CHART_FONT;
Chart.defaults.font.size = 12;
// The app renders its own HTML legend so identity is real text, not canvas pixels.
Chart.defaults.plugins.legend.display = false;
Chart.defaults.animation = { duration: 220 };

/** Options shared by every bar chart: recessive hairline chrome, muted axis ink,
 *  a hover layer, and no canvas legend. */
export function baseBarOptions(mode: Mode, opts: {
  horizontal?: boolean;
  stacked?: boolean;
  valueLabel?: (v: number) => string;
  onBarClick?: (index: number) => void;
} = {}): ChartOptions<'bar'> {
  const c = CHROME[mode];
  const { horizontal = true, stacked = false, valueLabel = (v: number) => v.toLocaleString() } = opts;

  return {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true,
    maintainAspectRatio: false,
    // Hit targets extend past the mark itself, so an 8px-tall bar is still easy to hover.
    interaction: { mode: 'nearest', axis: horizontal ? 'y' : 'x', intersect: false },
    onHover: (event, elements) => {
      const target = event.native?.target as HTMLElement | undefined;
      if (target) target.style.cursor = opts.onBarClick && elements.length ? 'pointer' : 'default';
    },
    onClick: (_event, elements) => {
      if (!opts.onBarClick || !elements.length) return;
      opts.onBarClick(elements[0].index);
    },
    layout: { padding: { top: 4, right: 12, bottom: 0, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: c.surface,
        titleColor: c.ink,
        bodyColor: c.muted,
        borderColor: c.axis,
        borderWidth: 1,
        cornerRadius: 6,
        padding: 10,
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { weight: 600, size: 12 },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx) => {
            const v = (horizontal ? ctx.parsed.x : ctx.parsed.y) ?? 0;
            const name = ctx.dataset.label;
            return name ? `${name}: ${valueLabel(v)}` : valueLabel(v);
          },
        },
      },
    },
    scales: {
      x: {
        stacked,
        beginAtZero: true,
        border: { display: !horizontal, color: c.axis },
        // Hairline, solid, one step off the surface. Never dashed.
        grid: { display: horizontal, color: c.grid, lineWidth: 1, drawTicks: false },
        ticks: {
          color: c.muted,
          padding: 8,
          font: { size: 11 },
          precision: 0,
          callback: (v) => Number(v).toLocaleString(),
        },
      },
      y: {
        stacked,
        beginAtZero: true,
        border: { display: horizontal, color: c.axis },
        grid: { display: !horizontal, color: c.grid, lineWidth: 1, drawTicks: false },
        ticks: { color: c.muted, padding: 8, font: { size: 12 }, autoSkip: false },
      },
    },
    elements: {
      bar: {
        borderRadius: MARKS.dataEndRadius,
        // Square at the baseline, rounded at the data-end.
        borderSkipped: 'start',
      },
    },
  };
}
