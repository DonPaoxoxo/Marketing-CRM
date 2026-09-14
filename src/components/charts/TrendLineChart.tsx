import * as React from 'react';
import { Line } from 'react-chartjs-2';
import { ChartFrame, type LegendItem, type TableView } from './ChartFrame';
import { CATEGORICAL, CHART_FONT, CHROME, MARKS, SERIES_CAP } from './palette';
import { useTheme } from '@/hooks/useTheme';
import { formatDate } from '@/lib/utils';

export interface TrendPoint {
  date: string;    // YYYY-MM-DD
  /** null: the date is on the axis but nothing was recorded. */
  value: number | null;
}

export interface TrendSeries {
  label: string;
  points: TrendPoint[];
}

/**
 * Change over time.
 *
 * Series may legitimately disagree on which dates they have — a day nobody
 * recorded is a real gap, so the x axis is the union of every date and missing
 * points are `null`, drawn as a line that spans the gap rather than a value
 * invented to fill it.
 */
export function TrendLineChart({
  title, description, series, valueName = 'Value', height = 260, footnote, valueFormat,
  breakAtGaps = false, smooth = true,
}: {
  title: string;
  description?: string;
  series: TrendSeries[];
  valueName?: string;
  height?: number;
  footnote?: React.ReactNode;
  valueFormat?: (v: number) => string;
  /** Show an unrecorded date as a break in the line instead of bridging it. */
  breakAtGaps?: boolean;
  /** Curve the line. Off for data where a curve would suggest values between records. */
  smooth?: boolean;
}) {
  const { resolved } = useTheme();
  const chrome = CHROME[resolved];
  const format = valueFormat ?? ((v: number) => v.toLocaleString());

  if (series.length > SERIES_CAP.adjacent) {
    throw new Error(
      `TrendLineChart: ${series.length} series exceeds the ${SERIES_CAP.adjacent}-slot cap. Show fewer lines or facet.`,
    );
  }

  // The union of every series' dates, in order — the shared category axis.
  const dates = React.useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort(),
    [series],
  );

  const datasets = React.useMemo(
    () => series.map((s, i) => {
      const byDate = new Map(s.points.map((p) => [p.date, p.value]));
      const values = dates.map((d) => byDate.get(d) ?? null);
      // With gaps broken, a lone recorded day between gaps still needs a visible mark.
      const lastIndex = values.reduce((last, v, i2) => (v !== null ? i2 : last), -1);
      const color = CATEGORICAL[resolved][i];
      return {
        label: s.label,
        data: values,
        borderColor: color,
        backgroundColor: color,
        borderWidth: MARKS.lineWidth,
        tension: smooth ? 0.25 : 0,
        // By default a missed day is bridged; `breakAtGaps` leaves it visibly empty.
        spanGaps: !breakAtGaps,
        // Points only at the series end and on hover — a dot on all 45 days is noise.
        pointRadius: values.map((v, i2) => (i2 === lastIndex || (breakAtGaps && v !== null && values[i2 - 1] == null && values[i2 + 1] == null) ? MARKS.pointRadius : 0)),
        pointHoverRadius: MARKS.pointRadius,
        // 2px surface ring so end dots stay legible where lines cross.
        pointBorderColor: chrome.surface,
        pointBorderWidth: MARKS.surfaceGap,
        pointBackgroundColor: color,
      };
    }),
    [series, dates, resolved, chrome.surface, breakAtGaps, smooth],
  );

  const legend: LegendItem[] = series.map((s, i) => ({ label: s.label, color: CATEGORICAL[resolved][i] }));

  const table: TableView = {
    columns: ['Date', ...series.map((s) => s.label)],
    rows: dates.map((d) => [
      formatDate(d),
      ...series.map((s) => {
        const v = s.points.find((p) => p.date === d)?.value;
        return v === undefined || v === null ? 'not recorded' : format(v);
      }),
    ]),
  };

  return (
    <ChartFrame title={title} description={description} legend={legend} table={table} height={height} footnote={footnote}>
      <Line
        key={resolved}
        role="img"
        aria-label={`${title}. ${valueName}. ${series
          .map((s) => {
            const recorded = s.points.filter((p): p is { date: string; value: number } => p.value !== null);
            return `${s.label}: ${recorded.length ? `${format(recorded[0].value)} on ${recorded[0].date} to ${format(recorded[recorded.length - 1].value)} on ${recorded[recorded.length - 1].date}` : 'no data'}`;
          })
          .join('. ')}`}
        data={{ labels: dates, datasets }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          // Hovering anywhere on the column reads that day, not just the 2px line.
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 6, right: 8 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: chrome.surface,
              titleColor: chrome.ink,
              bodyColor: chrome.muted,
              borderColor: chrome.axis,
              borderWidth: 1,
              cornerRadius: 6,
              padding: 10,
              usePointStyle: true,
              boxWidth: 8,
              boxHeight: 8,
              boxPadding: 4,
              titleFont: { weight: 600, size: 12 },
              callbacks: {
                title: (items) => (items.length ? formatDate(String(items[0].label)) : ''),
                label: (ctx) => {
                  const v = ctx.parsed.y;
                  if (v === null || v === undefined) return `${ctx.dataset.label}: not recorded`;
                  return `${ctx.dataset.label}: ${format(v)}`;
                },
              },
            },
          },
          scales: {
            x: {
              border: { color: chrome.axis },
              grid: { display: false },
              ticks: {
                color: chrome.muted,
                font: { size: 11, family: CHART_FONT },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 7,
                callback(value) {
                  const raw = this.getLabelForValue(Number(value));
                  return formatDate(raw).replace(/,? \d{4}$/, '');
                },
              },
            },
            y: {
              border: { display: false },
              grid: { color: chrome.grid, lineWidth: 1, drawTicks: false },
              ticks: {
                color: chrome.muted,
                padding: 8,
                font: { size: 11, family: CHART_FONT },
                maxTicksLimit: 6,
                callback: (v) => format(Number(v)),
              },
            },
          },
        }}
      />
    </ChartFrame>
  );
}
