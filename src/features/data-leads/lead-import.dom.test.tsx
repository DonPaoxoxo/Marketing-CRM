// @vitest-environment jsdom
/** The Data Leads bulk upload, driven the way a person uses it: pick country,
 *  platform and niche once, read the preview, add only the ready rows — a
 *  channel already in the register is skipped, never overwritten. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { BOOTSTRAP_KEY } from '@/hooks/useData';
import { LeadImportDialog } from './LeadImportDialog';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => loadFixtures());
afterEach(() => cleanup());

const sheet = [
  'Platform,Creator,ChannelURL,Subscribers,Tier,Keyword,PromoConfidence,EvidenceVideoTitle,EvidenceVideoURL,PublicEmail,PublicTelegram,PublicInstagram,Status',
  'YouTube,New Creator One,https://www.youtube.com/channel/UCNEWCREATOR0000001,50000,micro-nano (10k-100k),rummy,High,Evidence title one,https://www.youtube.com/watch?v=abc,new1@example.com,,,Not contacted',
  // Same channel as the India/YouTube fixture lead — must be skipped as a duplicate.
  'YouTube,DK Online Tech,https://www.youtube.com/channel/UCaZmbb9RVT1WTnyk6OQzs5A,95300,micro-nano (10k-100k),colour prediction,High,dup,https://www.youtube.com/watch?v=dup,,,,',
  // No creator — refused.
  'YouTube,,https://www.youtube.com/channel/UCMISSINGCREATOR001,1000,,,,,,,,',
].join('\n');

async function mountAndChoose() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <LeadImportDialog open onOpenChange={() => undefined} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  // Country and platform default to the first of each once the workspace loads.
  await waitFor(() => expect(qc.getQueryData(BOOTSTRAP_KEY)).toBeTruthy());
  // The niche field only exists on this "choose" step — gone once the preview replaces it.
  fireEvent.change(screen.getByLabelText('Niche'), { target: { value: 'Casino/Betting' } });
  const file = new File([sheet], 'leads.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Lead sheet file'), { target: { files: [file] } });
  // Not /ready/ alone — "Already a lead in the register" also contains that substring.
  await screen.findByText(/\d+ ready/);
}

describe('Data Leads bulk upload', () => {
  it('previews the sheet: one ready, one duplicate, one missing a required field', async () => {
    await mountAndChoose();
    expect(screen.getByText(/^1 ready$/)).toBeTruthy();
    expect(screen.getByText(/2 with problems/)).toBeTruthy();

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('New Creator One');
    expect(rows[1].textContent).toMatch(/already a lead in the register/i);
    expect(rows[2].textContent).toMatch(/Creator:.*Required/);
  });

  it('adds only the ready row, tagged with the chosen country, platform and niche', async () => {
    await mountAndChoose();
    const before = db.dataLeads.length;

    fireEvent.click(screen.getByRole('button', { name: /Add 1 lead/ }));
    expect(await screen.findByText(/1 lead added from leads\.csv/)).toBeTruthy();

    expect(db.dataLeads.length).toBe(before + 1);
    const created = db.dataLeads.find((l) => l.creator === 'New Creator One')!;
    expect(created).toMatchObject({
      countryCode: 'IN', platformId: 'PLT-04', niche: 'Casino/Betting',
      channelUrl: 'https://www.youtube.com/channel/UCNEWCREATOR0000001',
      followerCount: 50000, publicEmail: 'new1@example.com', status: 'Not contacted',
      contactedAt: null, contactedById: null,
    });
    // The duplicate channel was skipped, never overwritten.
    expect(db.dataLeads.filter((l) => l.channelUrl === 'https://www.youtube.com/channel/UCaZmbb9RVT1WTnyk6OQzs5A')).toHaveLength(1);
  });
});
