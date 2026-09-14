// @vitest-environment jsdom
/** Content performance shows each post's URL as a link to the video. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { ThemeProvider } from '@/hooks/useTheme';
import { displayUrl } from '@/lib/utils';
import GrowthPage from './Growth';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => cleanup());

beforeEach(() => {
  loadFixtures();
  // A small workspace: three posts, one without a URL. Rendering the whole
  // fixture set makes jsdom slow enough to starve parallel suites.
  const posts = db.contentPosts.filter((p) => !p.archived).slice(0, 3);
  posts[0].url = 'https://www.tiktok.com/@lenny/video/7412345678901234567';
  posts[1].url = 'https://youtube.com/shorts/AbC123xyz/';
  posts[2].url = '';
  db.contentPosts = posts;
  db.followerSnapshots = [];
});

describe('displayUrl', () => {
  it('drops the scheme, www and trailing slash, keeping case', () => {
    expect(displayUrl('https://www.tiktok.com/@Lenny/video/74123/')).toBe('tiktok.com/@Lenny/video/74123');
  });
});

describe('Content performance — Post URL column', () => {
  it('shows a link to each post, and says when a post has none', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <SessionProvider>
            <MemoryRouter initialEntries={['/growth']}>
              <GrowthPage />
            </MemoryRouter>
          </SessionProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    );

    const tab = await screen.findByRole('tab', { name: /Content performance/ });
    fireEvent.mouseDown(tab, { button: 0 });

    // Wait for the post rows themselves, not just the header: the table draws
    // its columns before the data arrives.
    const tiktok = await waitFor(() => {
      const link = document.querySelector('a[href="https://www.tiktok.com/@lenny/video/7412345678901234567"]');
      expect(link).toBeTruthy();
      return link as HTMLAnchorElement;
    }, { timeout: 10000 });

    const table = tiktok.closest('table')!;
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    expect(headers.some((h) => h.includes('Post URL'))).toBe(true);

    expect(tiktok.textContent).toBe('tiktok.com/@lenny/video/7412345678901234567');
    expect(tiktok.getAttribute('target')).toBe('_blank');
    expect(tiktok.getAttribute('rel')).toContain('noopener');
    const links = [...table.querySelectorAll('a[target="_blank"]')];
    expect(links.some((a) => a.textContent === 'youtube.com/shorts/AbC123xyz')).toBe(true);
    expect(table.textContent).toContain('No URL');
  }, 20000);
});
