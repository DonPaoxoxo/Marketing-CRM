// @vitest-environment jsdom
/** Shared Spiel Library page: library, copy, role-based tabs, the editor and the AI panel. */

import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider, useSession } from '@/hooks/useSession';
import type { RoleName } from '@/lib/types';
import type { Spiel, SpielVersion } from '@/lib/spiels';
import SharedSpielPage from './SharedSpiel';

const API = `${window.location.origin}/api`;
const version: SpielVersion = {
  id: 'SPV-00001', versionNo: 2, title: 'Warm first hello', categoryId: 'SCT-0001', categoryName: 'Greeting Spiel',
  content: 'Hello! Thank you for connecting with **Bright**.', situation: 'First contact', targetCountry: 'India', language: 'English',
  platform: 'WhatsApp', campaignRef: '', tags: ['greeting'], status: 'Approved', adminFeedback: '', createdById: 'TM-04', createdByName: 'Rohit Menon',
  createdAt: '2026-09-10T08:00:00.000Z', updatedByName: '', updatedAt: '2026-09-10T08:00:00.000Z', submittedAt: null, reviewedByName: 'Priya', reviewedAt: '2026-09-11T08:00:00.000Z',
};
const spiel: Spiel & { pendingVersion: boolean } = {
  id: 'SPL-0001', status: 'Approved', approved: version, current: version, approvedByName: 'Priya', approvedAt: '2026-09-11T08:00:00.000Z',
  usageCount: 3, lastUsedAt: null, createdById: 'TM-04', createdByName: 'Rohit Menon', createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-11T08:00:00.000Z',
  favorite: false, note: '', favoriteCount: 0, canEdit: false, pendingVersion: false,
};
const AI_OK = { corrected_text: '', improved_text: 'Hello there! Thanks so much for reaching out.', alternative_versions: ['Hi! Great to hear from you.'], tone: 'Friendly', language: 'English', situation_advice: 'Keep it short.', changes_made: ['Warmer opening'], recommended_category: 'Greeting Spiel', warnings: [] };

const calls: { method: string; path: string; body: unknown }[] = [];
const record = async (request: Request) => {
  const body = request.method === 'GET' ? null : await request.clone().json().catch(() => null);
  calls.push({ method: request.method, path: new URL(request.url).pathname, body });
};
let aiMode: 'ok' | 'fail' = 'ok';
const HISTORY_ITEM = {
  id: 'AIR-000009', action: 'reply', inputText: 'Your commission is too low', context: { situation: 'Agent says commission is low', platform: 'Telegram' },
  suggestion: { ...{ corrected_text: '', improved_text: 'I understand. Our weekly payouts are reliable, and top partners earn bonuses.', alternative_versions: [], tone: 'Empathetic', language: 'English', situation_advice: '', changes_made: [], recommended_category: '', warnings: [] } },
  model: 'nvidia/nemotron-3-super-120b-a12b:free', modelPosition: 2, tier: 'main', spielId: null, documentCount: 0, createdAt: '2026-09-14T09:00:00.000Z',
};
let history = [HISTORY_ITEM];

const server = setupServer(
  http.get(`${API}/spiels/library`, () => HttpResponse.json({ spiels: [spiel], announcement: 'Use the Diwali greetings from Monday.', today: '2026-09-14', isSystemOwner: false, mayWrite: true })),
  http.get(`${API}/spiels/mine`, () => HttpResponse.json({ spiels: [] })),
  http.get(`${API}/spiels/reviews`, () => HttpResponse.json({ spiels: [] })),
  http.get(`${API}/spiels/categories`, () => HttpResponse.json({ categories: [{ id: 'SCT-0001', name: 'Greeting Spiel', sortOrder: 1, active: true }, { id: 'SCT-0005', name: 'Follow-up Spiel', sortOrder: 5, active: true }] })),
  http.get(`${API}/spiels/documents`, () => HttpResponse.json({ documents: [] })),
  http.get(`${API}/spiels/ai/status`, () => HttpResponse.json({ enabled: true, configured: true, mayUse: true, requestsLeftToday: 39, maxRegenerations: 3, primaryModel: 'qwen/qwen3-32b:free' })),
  http.get(`${API}/spiels/ai/settings`, () => HttpResponse.json({ settings: { enabled: true, models: [{ id: 'qwen/qwen3-32b:free', enabled: true }], temperature: 0.4, maxOutputTokens: 1200, timeoutMs: 30000, dailyLimitPerMember: 40, maxRegenerations: 3, maxDocumentChars: 12000 }, configured: true })),
  http.get(`${API}/spiels/ai/logs`, () => HttpResponse.json({ today: { requests: 0, failed: 0, fallbacks: 0, tokens: 0 }, logs: [] })),
  http.post(`${API}/spiels/:id/use`, async ({ request }) => { await record(request); return HttpResponse.json({ usageCount: 4 }); }),
  http.post(`${API}/spiels/check-similar`, () => HttpResponse.json({ similar: [] })),
  http.post(`${API}/spiels`, async ({ request }) => {
    await record(request);
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...spiel, id: 'SPL-0002', status: body.submit ? 'Pending Approval' : 'Draft', approved: null, current: { ...version, title: body.title }, versions: [], approvals: [], comments: [], documents: [], canEdit: true }, { status: 201 });
  }),
  http.post(`${API}/spiels/ai/assist`, async ({ request }) => {
    await record(request);
    const body = await request.json() as { text: string };
    if (aiMode === 'fail') return HttpResponse.json({ message: 'The AI models are busy or rate-limited right now. Your text is unchanged — try again in a minute.', errorType: 'rate-limited', original: body.text, attempts: [] }, { status: 429 });
    return HttpResponse.json({ requestId: 'AIR-000001', original: body.text, suggestion: AI_OK, model: 'nex-agi/nex-n2.5-pro:free', usedFallback: true, modelPosition: 4, tier: 'fallback', attempts: [], redactions: 0, documentsUsed: [], regenerationsLeft: 3, requestsLeftToday: 38 });
  }),
  http.get(`${API}/spiels/ai/history`, () => HttpResponse.json({ items: history, total: history.length })),
  http.delete(`${API}/spiels/ai/history/:id`, async ({ request, params }) => { await record(request); history = history.filter((h) => h.id !== params.id); return HttpResponse.json({ removed: params.id }); }),
  http.get(`${API}/spiels/:id`, () => HttpResponse.json({ ...spiel, versions: [version], approvals: [], comments: [], documents: [] })),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(() => { cleanup(); calls.length = 0; aiMode = 'ok'; history = [HISTORY_ITEM]; });
afterAll(() => server.close());

function As({ role, children }: { role: RoleName; children: React.ReactNode }) {
  const { role: current, setRole } = useSession();
  React.useEffect(() => { setRole(role); }, [role, setRole]);
  return current === role ? <>{children}</> : null;
}

function mount(role: RoleName, url = '/shared-spiel') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <As role={role}><MemoryRouter initialEntries={[url]}><SharedSpielPage /></MemoryRouter></As>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Shared Spiel Library page', () => {
  it('lists the member\'s AI history, reuses an entry and removes one', async () => {
    mount('Marketing Staff', '/shared-spiel?tab=assistant');
    const list = await screen.findByRole('list', { name: 'AI history' }, { timeout: 8000 });
    expect(within(list).getByText(/Your commission is too low/)).toBeTruthy();
    expect(within(list).getByText('Main model 2')).toBeTruthy();

    fireEvent.click(within(list).getByRole('button', { name: /Reuse suggestion/ }));
    expect(((await screen.findByLabelText(/Suggested text/)) as HTMLTextAreaElement).value).toContain('weekly payouts are reliable');
    expect((screen.getByLabelText('Text to work on') as HTMLTextAreaElement).value).toBe('Your commission is too low');

    fireEvent.click(within(list).getByRole('button', { name: /Remove history entry/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Remove/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/spiels/ai/history/AIR-000009')).toBe(true));
    expect(await screen.findByText(/No suggestions yet/, {}, { timeout: 8000 })).toBeTruthy();
  });

  it('shows approved spiels with their labels and copies the formatted version', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount('Marketing Staff');
    expect(await screen.findByText('Submit, review, improve, and reuse approved communication scripts across the marketing team.')).toBeTruthy();
    expect(await screen.findByText(/Use the Diwali greetings/)).toBeTruthy();
    const card = await screen.findByRole('article', { name: 'Warm first hello' }, { timeout: 8000 });
    expect(within(card).getByText('Greeting Spiel')).toBeTruthy();
    expect(within(card).getByText('WhatsApp')).toBeTruthy();
    expect(within(card).getByText(/v2 · approved .* · 3 uses/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Hello! Thank you for connecting with *Bright*.'));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/spiels/SPL-0001/use')).toBe(true));
    // Members get no review or settings tabs.
    expect(screen.queryByRole('tab', { name: /Pending Reviews/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /Settings/ })).toBeNull();
  });

  it('gives the System Administrator the review and settings tabs', async () => {
    mount('System Administrator');
    expect(await screen.findByRole('tab', { name: /Pending Reviews/ }, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeTruthy();
  });

  it('saves a draft without ever sending an owner field', async () => {
    mount('Marketing Staff');
    fireEvent.click(await screen.findByRole('button', { name: /New spiel/ }, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Follow up gently' } });
    fireEvent.change(within(dialog).getByLabelText(/^Category/, { selector: '#spiel-categoryId' }), { target: { value: 'SCT-0005' } });
    fireEvent.change(within(dialog).getByLabelText(/^Script/), { target: { value: 'Hi! Just following up on my last message. Any questions?' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save draft/ }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/api/spiels')).toBeTruthy());
    const body = calls.find((c) => c.path === '/api/spiels')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ title: 'Follow up gently', categoryId: 'SCT-0005', submit: false });
    expect(Object.keys(body)).not.toContain('createdBy');
  });

  it('shows the AI suggestion separately, keeps the original, and applies it only when chosen', async () => {
    mount('Marketing Staff');
    fireEvent.click(await screen.findByRole('button', { name: /New spiel/ }, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog');
    const script = within(dialog).getByLabelText(/^Script/) as HTMLTextAreaElement;
    fireEvent.change(script, { target: { value: 'hello thanks for reach us' } });
    expect(within(dialog).getByText('AI suggestions may contain mistakes. Review the content before submitting it for approval.')).toBeTruthy();

    aiMode = 'fail';
    fireEvent.click(within(dialog).getByRole('button', { name: 'Improve Wording' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain('Your original text is unchanged');
    expect(script.value).toBe('hello thanks for reach us');

    aiMode = 'ok';
    fireEvent.click(within(dialog).getByRole('button', { name: 'Improve Wording' }));
    const suggestion = await within(dialog).findByLabelText(/Suggested text/) as HTMLTextAreaElement;
    expect(suggestion.value).toBe(AI_OK.improved_text);
    expect(within(dialog).getByText(/Fallback model: nex-agi\/nex-n2.5-pro:free/)).toBeTruthy();
    expect(script.value).toBe('hello thanks for reach us');
    const aiBody = calls.find((c) => c.path === '/api/spiels/ai/assist' && (c.body as { action: string }).action === 'improve')!.body as Record<string, unknown>;
    expect(aiBody).toMatchObject({ text: 'hello thanks for reach us', platform: 'WhatsApp', country: 'India' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose' }));
    expect(suggestion.value).toBe('Hi! Great to hear from you.');
    fireEvent.click(within(dialog).getByRole('button', { name: /Use this suggestion/ }));
    expect(script.value).toBe('Hi! Great to hear from you.');
  });
});
