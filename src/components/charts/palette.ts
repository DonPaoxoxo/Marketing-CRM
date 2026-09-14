/** Chart palette for the Marketing Resource CRM.
 *
 *  Derived from the CRM's own design tokens (neutral gray surfaces, teal accent)
 *  and validated with the data-viz six checks — not hand-picked. Slot 1 is the
 *  brand teal; the remaining slots were chosen by enumerating candidate orderings
 *  and keeping the one that maximises the minimum adjacent CVD separation.
 *
 *  Validation results (OKLab ΔE ×100, Machado-Oliveira-Fernandes 2009 @ severity 1.0):
 *
 *    Categorical, adjacent pairlist (bars, stacks, lines) — all six slots:
 *      light (surface #ffffff): worst CVD ΔE 13.9 · normal-vision ΔE 22.6 · all ≥ 3:1 — PASS
 *      dark  (surface #191c20): worst CVD ΔE 12.8 · normal-vision ΔE 21.3 · all ≥ 3:1 — PASS
 *
 *    Categorical, all-pairs pairlist (scatter/bubble/small multiples) — first THREE slots:
 *      light: worst CVD ΔE 12.8 · normal-vision ΔE 24.1 — PASS
 *      dark:  worst CVD ΔE 13.6 · normal-vision ΔE 22.4 — PASS
 *      => all-pairs chart forms cap at three series. Fold the tail into "Other" or facet.
 *
 *    Ordinal teal ramp (--ordinal): monotone L, adjacent ΔL ≥ 0.06, light end
 *      2.59:1 light / 3.52:1 dark — PASS in both modes.
 *
 *  Re-run after any change:
 *    node scripts/validate_palette.js "<hex,...>" --mode light --surface "#ffffff"
 *    node scripts/validate_palette.js "<hex,...>" --mode dark  --surface "#191c20"
 */

export type Mode = 'light' | 'dark';

/** Fixed hue order. Assigned in sequence, never cycled — the order is the CVD-safety
 *  mechanism, so it must not be reshuffled or extended with generated hues. */
export const CATEGORICAL: Record<Mode, string[]> = {
  light: ['#008f89', '#6946bf', '#dd691e', '#2d74ca', '#b88a01', '#d54d8a'],
  dark: ['#00a89f', '#876ad2', '#db712a', '#3e89d7', '#b38c15', '#dd6095'],
};

export const CATEGORICAL_HUE_NAMES = ['teal', 'violet', 'orange', 'blue', 'yellow', 'magenta'];

/** Series count past which we must fold into "Other" or facet, per pairlist. */
export const SERIES_CAP = { adjacent: 6, all: 3 } as const;

/** One hue, light→dark for magnitude. The dark mode ramp flips its anchor so the
 *  light end still clears the dark surface. */
export const SEQUENTIAL: Record<Mode, string[]> = {
  light: ['#67ada8', '#429691', '#087f7a', '#006965'],
  dark: ['#0b7f79', '#43968f', '#68ada7', '#8ac4be'],
};

/** Reserved meaning. Never used for "series 4", and always shipped with an icon + label. */
export const STATUS: Record<Mode, Record<'good' | 'warning' | 'serious' | 'critical', string>> = {
  light: { good: '#0f8a4d', warning: '#a8720a', serious: '#c0561f', critical: '#c2352f' },
  dark: { good: '#3cc47f', warning: '#d99a22', serious: '#e8814a', critical: '#e86b66' },
};

/** Chart chrome. Kept in step with the app's surface/border/ink tokens in index.css. */
export const CHROME: Record<Mode, {
  surface: string; grid: string; axis: string; muted: string; ink: string; deemphasis: string;
}> = {
  light: {
    surface: '#ffffff',
    grid: '#ebedf0',
    axis: '#dbdee2',
    muted: '#5f656d',
    ink: '#171b20',
    deemphasis: '#c7ccd2',
  },
  dark: {
    surface: '#191c20',
    grid: '#24272c',
    axis: '#313439',
    muted: '#9399a0',
    ink: '#eef0f3',
    deemphasis: '#464b52',
  },
};

/** Mark specs, fixed across every chart in the app. */
export const MARKS = {
  maxBarThickness: 24,
  dataEndRadius: 4,
  lineWidth: 2,
  pointRadius: 4,
  /** Surface-coloured gap separating touching marks (stacked segments, adjacent bars). */
  surfaceGap: 2,
  areaOpacity: 0.1,
} as const;

export const CHART_FONT =
  'ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
