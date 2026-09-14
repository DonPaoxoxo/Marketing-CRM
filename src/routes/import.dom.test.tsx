// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';
import ImportPage from './Import';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
// The shipped workspace is empty; these tests want the synthetic dataset.
beforeEach(() => loadFixtures());
afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter>
            <ImportPage />
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** Row of the preview table whose first data cell is this row number. */
function previewRow(n: number) {
  const table = screen.getAllByRole('table').at(-1)!;
  return within(table).getAllByRole('row').find((r) => r.querySelector('td')?.textContent === String(n))!;
}

async function pasteSocialAccounts(csv: string) {
  mount();
  await screen.findByLabelText(/Upload a CSV file/);
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'social-accounts' } });
  fireEvent.change(screen.getByLabelText(/paste CSV content/i), { target: { value: csv } });
  await waitFor(() => expect(screen.getAllByRole('table').length).toBeGreaterThan(0));
}

describe('CSV import preview — agents', () => {
  it('rejects a contact number another agent has, and one repeated in the file', async () => {
    const holder = db.agents.find((a) => !a.archived)!;
    holder.contactNumber = '+639170000001';
    mount();
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'agents' } });
    fireEvent.change(screen.getByLabelText(/paste CSV content/i), {
      target: {
        value: 'name,contactNumber\n' +
          'New Person,+63 917 000 0001\n' +
          'Second Person,+639170000555\n' +
          'Third Person,0063-917-000-0555\n',
      },
    });
    await waitFor(() => expect(previewRow(2)).toBeTruthy());
    expect(within(previewRow(2)).getByText(/Another agent already has this number/i)).toBeTruthy();
    expect(within(previewRow(3)).getByText('ready')).toBeTruthy();
    expect(within(previewRow(4)).getByText(/Duplicated earlier in this file/i)).toBeTruthy();
  });
});

describe('CSV import preview — social accounts', () => {
  it('accepts a handle that already exists on the same platform', async () => {
    const existing = db.socialAccounts[0];
    const platform = db.platforms.find((p) => p.id === existing.platformId)!;

    await pasteSocialAccounts(`platform,username,displayName\n${platform.name},${existing.username},Another page\n`);
    expect(within(previewRow(2)).getByText('ready')).toBeTruthy();
  });

  it('rejects a platform ID that already exists on that platform', async () => {
    const existing = db.socialAccounts.find((a) => a.platformAccountId && !a.archived)!;
    const platform = db.platforms.find((p) => p.id === existing.platformId)!;

    await pasteSocialAccounts(
      `platform,username,platformAccountId\n${platform.name},anything,${existing.platformAccountId}\n`,
    );
    expect(within(previewRow(2)).getByText(/platform ID already exists on that platform/i)).toBeTruthy();
  });

  it('detects the same platform ID twice within the file, whatever the handles', async () => {
    const platform = db.platforms[0];
    await pasteSocialAccounts(
      `platform,username,platformAccountId\n` +
      `${platform.name},Lenny,9990001112223\n` +
      `${platform.name},Lenny,9990001112223\n` +
      `${platform.name},Lenny,9990001112224\n`,
    );
    expect(within(previewRow(2)).getByText('ready')).toBeTruthy();
    expect(within(previewRow(3)).getByText(/Duplicated earlier in this file/i)).toBeTruthy();
    expect(within(previewRow(4)).getByText('ready')).toBeTruthy();
  });

  it('falls back to the profile URL when a row has no platform ID', async () => {
    const platform = db.platforms[0];
    await pasteSocialAccounts(
      `platform,username,profileUrl\n` +
      `${platform.name},Lenny,https://example.com/page-one\n` +
      `${platform.name},Lenny,https://example.com/page-one/\n` +
      `${platform.name},Lenny,\n` +
      `${platform.name},Lenny,\n`,
    );
    expect(within(previewRow(2)).getByText('ready')).toBeTruthy();
    expect(within(previewRow(3)).getByText(/Duplicated earlier in this file/i)).toBeTruthy();
    // Neither an ID nor a URL: nothing to compare, so both are simply new.
    expect(within(previewRow(4)).getByText('ready')).toBeTruthy();
    expect(within(previewRow(5)).getByText('ready')).toBeTruthy();
  });

  it('allows the same handle twice in a file when the platforms differ', async () => {
    const [a, b] = db.platforms;
    const handle = 'another-unused-handle';

    await pasteSocialAccounts(
      `platform,username,displayName\n` +
      `${a.name},${handle},On A\n` +
      `${b.name},${handle},On B\n`,
    );

    expect(within(previewRow(2)).getByText('ready')).toBeTruthy();
    expect(within(previewRow(3)).getByText('ready')).toBeTruthy();
  });

  it('rejects a registered page URL even when the row also carries a new platform ID', async () => {
    const existing = db.socialAccounts.find((a) => !a.archived)!;
    existing.profileUrl = 'https://www.facebook.com/xBrightgamers';
    const platform = db.platforms.find((p) => p.id === existing.platformId)!;

    await pasteSocialAccounts(
      `platform,username,platformAccountId,profileUrl\n` +
      `${platform.name},Lenny,5550001112223,http://m.facebook.com/xbrightgamers/\n`,
    );
    expect(within(previewRow(2)).getByText(/profile URL already exists/i)).toBeTruthy();
  });

  it('rejects an unknown platform', async () => {
    await pasteSocialAccounts(`platform,username\nNotARealPlatform,somehandle\n`);
    expect(within(previewRow(2)).getByText(/Unknown platform/i)).toBeTruthy();
  });
});

describe('CSV import preview — SIMs', () => {
  it('flags a number already in the register and one duplicated in the file', async () => {
    mount();
    await screen.findByLabelText(/Upload a CSV file/);
    const existing = db.sims.find((x) => !x.archived)!;
    fireEvent.change(screen.getByLabelText(/paste CSV content/i), {
      target: {
        value:
          `SIM Number,Created For,Telegram Username,Status\n` +
          `639175550420,Telegram,@demouser,Active\n` +
          `${existing.phoneNumber},,,Active\n` +
          `+63 917 555 0420,Telegram,@someoneelse,Dead / Patay\n`,
      },
    });
    await waitFor(() => expect(screen.getAllByRole('table').length).toBeGreaterThan(0));

    expect(within(previewRow(2)).getByText('ready')).toBeTruthy();
    expect(within(previewRow(3)).getByText(/already on a SIM in the register/i)).toBeTruthy();
    // +63 917 555 0420 is row 2's number written another way.
    expect(within(previewRow(4)).getByText(/appears earlier in this file/i)).toBeTruthy();
  });
});

describe('CSV import rejects credential columns outright', () => {
  it('names the rejected columns and keeps them unmappable', async () => {
    mount();
    await screen.findByLabelText(/Upload a CSV file/);
    fireEvent.change(screen.getByLabelText(/paste CSV content/i), {
      target: { value: `phoneNumber,password,api_key\n+919000000001,hunter2,abc123\n` },
    });

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Credential columns rejected/i)).toBeTruthy();
    expect(alert.textContent).toContain('password');
    expect(alert.textContent).toContain('api_key');

    // The rejected headers must not be selectable in any column mapping.
    const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).not.toContain('password');
    expect(options).not.toContain('api_key');
  });
});
