// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/hooks/useTheme';
import { CategoryBarChart } from './CategoryBarChart';
import { StackedBarChart } from './StackedBarChart';
import { CATEGORICAL, SEQUENTIAL, SERIES_CAP, STATUS } from './palette';

afterEach(() => cleanup());

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

const DATA = [
  { label: 'Instagram', value: 12 },
  { label: 'TikTok', value: 7 },
  { label: 'YouTube', value: 3 },
];

describe('every chart ships a table-view twin', () => {
  it('exposes the same numbers in the table as the chart plots', async () => {
    wrap(<CategoryBarChart title="Accounts by platform" data={DATA} valueName="Accounts" />);

    // Chart view first — the canvas carries an accessible description.
    const canvas = screen.getByRole('img', { name: /Accounts by platform/ });
    expect(canvas.getAttribute('aria-label')).toContain('Instagram: 12');

    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));

    const table = screen.getByRole('table');
    for (const [label, value] of [['Instagram', '12'], ['TikTok', '7'], ['YouTube', '3']]) {
      const row = within(table).getByRole('row', { name: new RegExp(`${label}\\s+${value}`) });
      expect(row).toBeTruthy();
    }
  });

  it('marks the active view for assistive tech', () => {
    wrap(<CategoryBarChart title="Accounts by platform" data={DATA} />);
    expect(screen.getByRole('button', { name: 'Chart view' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByRole('button', { name: 'Table view' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('legend rules', () => {
  it('shows no legend box for a single series — the title names it', () => {
    wrap(<CategoryBarChart title="Accounts by platform" data={DATA} />);
    expect(screen.queryByRole('list', { name: /legend/i })).toBeNull();
  });

  it('always shows a legend for two or more series, so identity is never colour-alone', () => {
    wrap(
      <StackedBarChart
        title="Allocation"
        rows={['Social accounts', 'SIMs']}
        series={[
          { label: 'Assigned', values: [10, 4] },
          { label: 'Reserved', values: [3, 2] },
          { label: 'Available', values: [1, 6] },
        ]}
      />,
    );
    const legend = screen.getByRole('list', { name: /Allocation legend/i });
    for (const label of ['Assigned', 'Reserved', 'Available']) {
      expect(within(legend).getByText(label)).toBeTruthy();
    }
  });
});

describe('series caps are enforced, never worked around with new hues', () => {
  it('folds categories past the cap into a single Other bar carrying their total', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `P${i}`, value: i + 1 }));
    wrap(<CategoryBarChart title="Many" data={many} maxBars={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));

    const table = screen.getByRole('table');
    // Top four kept (12, 11, 10, 9); the remaining eight (1..8) fold into Other = 36.
    expect(within(table).getByText('Other (8)')).toBeTruthy();
    expect(within(table).getByText('36')).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(6); // header + 5 bars
  });

  it('refuses more stacked series than the validated palette has slots', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tooMany = Array.from({ length: SERIES_CAP.adjacent + 1 }, (_, i) => ({
      label: `S${i}`, values: [1],
    }));
    expect(() => wrap(<StackedBarChart title="Too many" rows={['r']} series={tooMany} />)).toThrow(/exceeds the 6-slot cap/);
    spy.mockRestore();
  });
});

describe('status series wear status tokens, not categorical slots', () => {
  it('colours a status series from the reserved scale', () => {
    wrap(
      <StackedBarChart
        title="Domain expiry distribution"
        rows={['India']}
        series={[
          { label: 'Expired', status: 'critical', values: [4] },
          { label: 'Not due soon', status: 'good', values: [9] },
        ]}
      />,
    );
    const legend = screen.getByRole('list', { name: /legend/i });
    const swatches = within(legend).getAllByRole('listitem')
      .map((li) => (li.querySelector('span[style]') as HTMLElement)?.style.backgroundColor);

    // rgb() strings, so compare against the parsed status hexes rather than the raw hex.
    const toRgb = (hex: string) => {
      const n = hex.slice(1);
      return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
    };
    expect(swatches[0]).toBe(toRgb(STATUS.light.critical));
    expect(swatches[1]).toBe(toRgb(STATUS.light.good));
    // and never a categorical slot
    expect(swatches).not.toContain(toRgb(CATEGORICAL.light[0]));
  });
});

describe('empty data does not render an empty plot', () => {
  it('shows an empty state instead', () => {
    wrap(<CategoryBarChart title="Accounts by platform" data={[]} />);
    expect(screen.getByText('Nothing to plot')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Accounts by platform/ })).toBeNull();
  });
});

describe('palette structure', () => {
  it('keeps a fixed slot order with the same length in both modes', () => {
    expect(CATEGORICAL.light).toHaveLength(6);
    expect(CATEGORICAL.dark).toHaveLength(CATEGORICAL.light.length);
    expect(new Set(CATEGORICAL.light).size).toBe(CATEGORICAL.light.length);
    expect(new Set(CATEGORICAL.dark).size).toBe(CATEGORICAL.dark.length);
  });

  it('never reuses a status colour as a categorical slot', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const status of Object.values(STATUS[mode])) {
        expect(CATEGORICAL[mode]).not.toContain(status);
      }
    }
  });

  it('keeps the sequential ramp to a single hue per mode', () => {
    expect(SEQUENTIAL.light).toHaveLength(4);
    expect(SEQUENTIAL.dark).toHaveLength(4);
  });
});
