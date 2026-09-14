// @vitest-environment jsdom
/** The global buttons on every page: header and page toolbar. */

import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';
import { AppShell } from './AppShell';
import { ExportButton, FilterBar, SearchInput } from '@/components/common/controls';
import type { ExportColumn } from '@/lib/csv';

const writeExcel = vi.hoisted(() => vi.fn());
vi.mock('write-excel-file/browser', () => ({ default: (...args: unknown[]) => { writeExcel(...args); return { toFile: vi.fn().mockResolvedValue(undefined) }; } }));
const downloadCSV = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ downloadCSV }));

const server = setupServer(...handlers);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
afterAll(() => server.close());

interface Row { id: string; name: string; phone: string; password: string }
const ROWS: Row[] = [{ id: 'AGT-1', name: 'Rohit Menon', phone: '+919876543210', password: 'never' }, { id: 'AGT-2', name: 'Priya', phone: '+919800000000', password: 'never' }];
const COLUMNS: ExportColumn<Row>[] = [
  { key: 'id', header: 'ID', value: (r) => r.id },
  { key: 'name', header: 'Name', value: (r) => r.name },
  { key: 'phone', header: 'Phone', value: (r) => r.phone, sensitive: true },
  { key: 'password', header: 'Password', value: (r) => r.password },
];

function FakeAgentsPage({ onClear }: { onClear: () => void }) {
  const [search, setSearch] = React.useState('rohit');
  return (
    <div>
      <FilterBar activeCount={search ? 1 : 0} onClear={() => { setSearch(''); onClear(); }}>
        <SearchInput value={search} onChange={setSearch} />
      </FilterBar>
      <ExportButton rows={ROWS} columns={COLUMNS} filename="agents" recordType="Agent" />
    </div>
  );
}

function mount(onClear = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/agents?search=rohit']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/agents" element={<FakeAgentsPage onClear={onClear} />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { qc, onClear };
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Page actions' });

describe('global buttons', () => {
  it('shows every global button with an accessible name', async () => {
    mount();
    await screen.findByRole('toolbar', { name: 'Page actions' });
    for (const name of ['Refresh data', 'Notifications', /Switch to (dark|light) mode/, 'Help', 'Keyboard shortcuts', /User profile/]) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: /Search/ }).length).toBeGreaterThan(0);
    const bar = toolbar();
    for (const name of ['Filter', /Clear filters/, /Save view/, 'Print page', 'Copy link', 'Share report', 'Full-screen view']) {
      expect(within(bar).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(within(bar).getByText('Agents')).toBeTruthy();
  });

  it('clears the page filters, copies the link and refreshes data', async () => {
    const { qc, onClear } = mount();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');

    const clear = await within(toolbar()).findByRole('button', { name: 'Clear filters (1)' });
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((within(toolbar()).getByRole('button', { name: 'Clear filters' }) as HTMLButtonElement).disabled).toBe(true));

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    expect(invalidate).toHaveBeenCalled();
  });

  it('exports the page table to Excel without secrets and with contact details masked, and prints a PDF', async () => {
    mount();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await screen.findByRole('toolbar', { name: 'Page actions' });

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', shiftKey: true })); });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Password')).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Excel/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => expect(writeExcel).toHaveBeenCalled());
    const sheet = (writeExcel.mock.calls[0][0] as { data: { value: string }[][] }[])[0];
    expect(sheet.data[0].map((c) => c.value)).toEqual(['ID', 'Name', 'Phone']);
    expect(sheet.data[1].map((c) => c.value)).toEqual(['AGT-1', 'Rohit Menon', '[masked]']);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', shiftKey: true })); });
    const again = await screen.findByRole('dialog');
    fireEvent.click(within(again).getByRole('radio', { name: /PDF/ }));
    fireEvent.click(within(again).getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(document.getElementById('print-root')?.textContent).toContain('Rohit Menon');
    expect(document.getElementById('print-root')?.textContent).not.toContain('+919876543210');

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Print page' }));
    expect(print).toHaveBeenCalledTimes(2);
    print.mockRestore();
  });

  it('opens shortcuts, help and profile, toggles the theme, shares and goes full screen', async () => {
    mount();
    await screen.findByRole('toolbar', { name: 'Page actions' });

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); });
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findByRole('dialog', { name: 'Help — Agents' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'U', shiftKey: true })); });
    const profile = await screen.findByRole('dialog', { name: 'My profile' });
    expect(within(profile).getByText('What you can do')).toBeTruthy();
    fireEvent.keyDown(profile, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const wasDark = document.documentElement.classList.contains('dark');
    fireEvent.click(screen.getByRole('button', { name: /Switch to (dark|light) mode/ }));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(!wasDark));

    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Share report' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: window.location.href, title: expect.stringContaining('Agents') }));
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Share report' }));
    expect(await screen.findByRole('dialog', { name: 'Share report' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: request, configurable: true });
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Full-screen view' }));
    expect(request).toHaveBeenCalled();
  });

  it('collapses the sidebar to icons and folds navigation groups, remembering both', async () => {
    localStorage.clear();
    mount();
    const collapse = await screen.findByRole('button', { name: 'Collapse sidebar' });
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0];
    fireEvent.click(within(nav).getByRole('button', { name: /Registers/ }));
    expect(within(nav).getByRole('button', { name: /Registers/ }).getAttribute('aria-expanded')).toBe('false');
    // The page you are on stays visible inside a folded group.
    expect(within(nav).getByRole('link', { name: 'Agents' })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: 'Domains' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('mrcrm.navGroupsClosed') ?? '[]')).toEqual(['Registers']);

    fireEvent.click(collapse);
    expect(screen.getByRole('button', { name: 'Expand sidebar' }).getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('mrcrm.sidebarCollapsed')).toBe('true');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', shiftKey: true })); });
    expect(await screen.findByRole('button', { name: 'Collapse sidebar' })).toBeTruthy();
  });
});
