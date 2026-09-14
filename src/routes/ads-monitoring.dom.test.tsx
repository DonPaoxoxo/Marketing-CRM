// @vitest-environment jsdom
/** Ads Monitoring screens against a stubbed API: the campaign table, view-only
 *  state, the creative viewer and the import preview with explicit confirmation. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_ORIGIN, handlers } from '@/mocks/handlers';
import { loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';
import AdsMonitoringPage from './AdsMonitoring';

const campaign = (id: string, extra: Record<string, unknown> = {}) => ({
  id, reference: `PH-${id}`, name: `Campaign ${id}`, platformId: 'PLT-01', platformName: 'Facebook', brandId: null, brandName: '', projectId: null,
  targetCountryCode: 'PH', socialAccountId: null, socialAccountLabel: '', assignedStaffId: null, assignedStaffName: '', objective: 'Traffic', currency: 'PHP',
  budget: '30000.0000', startDate: '2026-08-29', endDate: '2026-09-27', status: 'Active', adsUrl: 'https://www.facebook.com/ads/library/?id=1',
  reportingTimezone: 'Asia/Manila', notes: '', createdById: 'TM-09', createdByName: 'Gordon', createdAt: '2026-08-28T00:00:00.000Z', updatedById: null,
  updatedByName: '', updatedAt: '2026-08-28T00:00:00.000Z', spend: '6248.7800', recordCount: 8,
  primaryResult: { label: 'Link clicks', value: 5507, costLabel: 'Cost per link click', cost: 1.1347 },
  trend: { metric: 'Cost per link click', status: 'insufficient', reason: 'Insufficient Data: the current period is missing 7 days.' },
  creatives: [], canEdit: false, ...extra,
});
const creative = (n: number) => ({ id: `ADK-000${n}`, fileName: `reel-${n}.png`, adsUrl: `https://www.facebook.com/ads/library/?id=${n}`, width: 1080, height: 1350, sizeBytes: 812_345, createdByName: 'Gordon', createdAt: '2026-09-01T08:00:00.000Z' });

let committed: { summary: string | null; mode: string } | null = null;
const server = setupServer(
  http.get(`${API_ORIGIN}/api/ads/campaigns`, () => HttpResponse.json({
    items: [
      campaign('ADC-0001', { creatives: [creative(1), creative(2), creative(3)] }),
      campaign('ADC-0002', { name: 'Mine', createdById: 'TM-01', createdByName: 'Priya Raghunathan', canEdit: true, currency: 'VND', spend: '2500000.0000', budget: null }),
    ],
    total: 2, page: 1, pageSize: 25,
  })),
  http.post(`${API_ORIGIN}/api/ads/import/preview`, () => HttpResponse.json({
    missingColumns: [], tooManyRows: false,
    summary: { campaignsToCreate: 1, entriesToCreate: 2, entriesToUpdate: 0, skipped: 1, rejected: 1 },
    rows: [
      { rowNumber: 2, reference: 'EXAMPLE-DO-NOT-IMPORT', reportDate: '2026-08-29', action: 'skip', errors: [], warnings: ['Example row from the template — skipped.'] },
      { rowNumber: 3, reference: 'PH-NEW', reportDate: '2026-09-01', action: 'create-campaign', errors: [], warnings: [] },
      { rowNumber: 4, reference: 'PH-NEW', reportDate: '2026-09-02', action: 'create-entry', errors: [], warnings: [] },
      { rowNumber: 5, reference: 'PH-OTHER', reportDate: '2026-09-02', action: 'reject', errors: ['Campaign PH-OTHER belongs to someone else.'], warnings: [] },
    ],
  })),
  http.post(`${API_ORIGIN}/api/ads/import/commit`, ({ request }) => {
    committed = { summary: request.headers.get('x-expected-summary'), mode: new URL(request.url).searchParams.get('mode') ?? '' };
    return HttpResponse.json({ importId: 'ADI-0001', campaignsCreated: 1, created: 2, updated: 0, skipped: 1, rejected: 1, rows: [] }, { status: 201 });
  }),
  http.get(`${API_ORIGIN}/api/ads/overview`, () => HttpResponse.json({ activeCampaigns: 0, campaignsTracked: 0, spendByCurrency: [], engagement: { interactions: 0, completeCampaigns: 0, incompleteCampaigns: 0 }, objectiveCosts: [], campaigns: [], followUpsOpen: [], settings: { stablePct: 5, endingSoonDays: 7 } })),
  ...handlers,
);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterAll(() => server.close());
afterEach(() => cleanup());
beforeEach(() => { loadFixtures(); committed = null; });

function mount(route = '/ads-monitoring?tab=campaigns') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes><Route path="/ads-monitoring" element={<AdsMonitoringPage />} /></Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Ads Monitoring', () => {
  it('lists campaigns with every required column, in each campaign’s own currency, and marks view-only rows', async () => {
    mount();
    const table = await screen.findByRole('table', { name: 'Ads campaigns' }, { timeout: 8000 });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers).toEqual(['Campaign', 'Brand', 'Country', 'Platform', 'Owner', 'Dates', 'Status', 'Currency', 'Budget', 'Spend', 'Primary Result', 'Cost per Result', 'Trend', 'Creative Used', 'Ads URL', 'Actions']);
    expect(await within(table).findByText('₱6,248.78', {}, { timeout: 8000 })).toBeTruthy();
    expect(within(table).getByText('₫2,500,000')).toBeTruthy();
    expect(within(table).getByText('₱1.13')).toBeTruthy();
    expect(within(table).getAllByText('Insufficient Data').length).toBeGreaterThan(0);
    expect(within(table).getByRole('link', { name: 'View' })).toBeTruthy();
    expect(within(table).getByRole('link', { name: 'Manage' })).toBeTruthy();
    const adsLink = within(table).getAllByRole('link', { name: /Open in Ads Library/ })[0];
    expect(adsLink.getAttribute('target')).toBe('_blank');
    expect(adsLink.getAttribute('rel')).toContain('noopener');
  });

  it('shows the first creative with “+N more” and opens a viewer with its details and navigation', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '+2 more' }, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'reel-2.png' })).toBeTruthy();
    expect(within(dialog).getByText('1080 × 1350 px')).toBeTruthy();
    expect(within(dialog).getByText(/812,345 bytes/)).toBeTruthy();
    expect(within(dialog).getByText(/by Gordon/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: /Download/ }).getAttribute('href')).toBe('/api/ads/creatives/ADK-0002/file?download');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next creative' }));
    expect(within(dialog).getByRole('heading', { name: 'reel-3.png' })).toBeTruthy();
  });

  it('previews an import row by row and writes only after explicit confirmation', async () => {
    mount('/ads-monitoring?tab=overview');
    fireEvent.click(await screen.findByRole('button', { name: /Upload Excel/ }, { timeout: 8000 }));
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'tracker.xlsx');
    fireEvent.change(screen.getByLabelText('Ads workbook file'), { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('1 new campaigns')).toBeTruthy();
    expect(within(dialog).getByText('Campaign PH-OTHER belongs to someone else.')).toBeTruthy();
    expect(committed).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirm import \(2 records\)/ }));
    await waitFor(() => expect(within(dialog).getByText('Import complete.')).toBeTruthy());
    expect(committed).toEqual({ summary: JSON.stringify({ campaignsToCreate: 1, entriesToCreate: 2, entriesToUpdate: 0, skipped: 1, rejected: 1 }), mode: 'skip' });
  });
});
