import { describe, expect, it, vi } from 'vitest';
import { OPENROUTER_URL, classifyStatus, runWithFallback, type RunOptions } from './openrouter';

const GOOD = { corrected_text: 'Hello.', improved_text: 'Hello there!', alternative_versions: [], tone: 'Friendly', language: 'English', situation_advice: '', changes_made: ['Warmer'], recommended_category: '', warnings: [] };
const ok = (content: string, usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });
const fail = (status: number, body = '{"error":{"message":"nope"}}') => new Response(body, { status });

function options(responses: (Response | Error)[], extra: Partial<RunOptions> = {}) {
  const calls: { model: string; messages: number; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(OPENROUTER_URL);
    const body = JSON.parse(String(init?.body));
    calls.push({ model: body.model, messages: body.messages.length, auth: new Headers(init?.headers).get('authorization') });
    const next = responses.shift();
    if (!next) throw new Error('unexpected call');
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const opts: RunOptions = {
    apiKey: 'sk-or-test-key', models: ['qwen/qwen3-32b:free', 'google/gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'text' }],
    temperature: 0.4, maxTokens: 500, timeoutMs: 1000, appOrigin: 'https://crm.example', fetchImpl, sleep: async () => {}, retriesPerModel: 1,
    ...extra,
  };
  return { opts, calls };
}

describe('OpenRouter fallback', () => {
  it('uses the primary model when it answers correctly', async () => {
    const { opts, calls } = options([ok(JSON.stringify(GOOD))]);
    const r = await runWithFallback(opts);
    expect(r).toMatchObject({ ok: true, model: 'qwen/qwen3-32b:free', usedFallback: false, suggestion: GOOD });
    expect(calls).toEqual([{ model: 'qwen/qwen3-32b:free', messages: 2, auth: 'Bearer sk-or-test-key' }]);
    expect(r.attempts[0].usage.total).toBe(30);
  });

  it('retries a rate limit with backoff, then falls back to the next model', async () => {
    const sleeps: number[] = [];
    const { opts, calls } = options([fail(429), fail(429), ok(JSON.stringify(GOOD))], { sleep: async (ms) => { sleeps.push(ms); } });
    const r = await runWithFallback(opts);
    expect(r).toMatchObject({ ok: true, model: 'google/gemma-3-27b-it:free', usedFallback: true });
    expect(calls.map((c) => c.model)).toEqual(['qwen/qwen3-32b:free', 'qwen/qwen3-32b:free', 'google/gemma-3-27b-it:free']);
    expect(sleeps).toHaveLength(1);
    expect(r.attempts.map((a) => a.errorType)).toEqual(['rate-limited', 'rate-limited', '']);
  });

  it('treats a timeout as transient and moves on', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { opts } = options([abort, abort, fail(503), fail(503), ok(JSON.stringify(GOOD))]);
    const r = await runWithFallback(opts);
    expect(r).toMatchObject({ ok: true, model: 'meta-llama/llama-3.3-70b-instruct:free' });
    expect(r.attempts.map((a) => a.errorType)).toEqual(['timeout', 'timeout', 'provider-unavailable', 'provider-unavailable', '']);
  });

  it('really times out a slow request', async () => {
    const slow = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;
    const r = await runWithFallback({ ...options([]).opts, models: ['a/b'], fetchImpl: slow, timeoutMs: 20, retriesPerModel: 0 });
    expect(r).toMatchObject({ ok: false, errorType: 'timeout' });
  });

  it('asks once for valid JSON, then falls back when the reply is still malformed', async () => {
    const { opts, calls } = options([ok('Here you go: Hello there!'), ok('still not json'), ok(JSON.stringify(GOOD))]);
    const r = await runWithFallback(opts);
    expect(r).toMatchObject({ ok: true, model: 'google/gemma-3-27b-it:free', usedFallback: true });
    // The correction retry carries the bad reply and a correction instruction.
    expect(calls.map((c) => c.messages)).toEqual([2, 4, 2]);
    expect(r.attempts.map((a) => a.errorType)).toEqual(['malformed-json', 'malformed-json', '']);
  });

  it('recovers when the correction retry returns valid JSON', async () => {
    const { opts } = options([ok('{"improved_text": 1}'), ok(JSON.stringify(GOOD))]);
    expect(await runWithFallback(opts)).toMatchObject({ ok: true, model: 'qwen/qwen3-32b:free', usedFallback: false });
  });

  it('moves straight past 402, unavailable models, empty replies and inline provider errors', async () => {
    const inline = () => new Response(JSON.stringify({ error: { code: 502, message: 'Provider returned error' } }), { status: 200 });
    const { opts } = options([fail(402), fail(404, '{"error":{"message":"No endpoints found"}}'), inline(), inline(), ok(JSON.stringify(GOOD))], {
      models: ['a/one', 'b/two', 'c/three', 'd/four'],
    });
    const r = await runWithFallback(opts);
    expect(r).toMatchObject({ ok: true, model: 'd/four' });
    expect(r.attempts.map((a) => a.errorType)).toEqual(['no-credit', 'model-unavailable', 'bad-gateway', 'bad-gateway', '']);
  });

  it('stops at once on a rejected key and reports every failure clearly', async () => {
    const { opts, calls } = options([fail(401)]);
    expect(await runWithFallback(opts)).toMatchObject({ ok: false, errorType: 'auth', message: expect.stringContaining('OPENROUTER_API_KEY') });
    expect(calls).toHaveLength(1);

    const all = options([fail(500), fail(500), fail(502), fail(502), fail(408), fail(408)]);
    const r = await runWithFallback(all.opts);
    expect(r).toMatchObject({ ok: false, errorType: 'request-timeout', message: expect.stringContaining('unchanged') });
    expect(r.attempts).toHaveLength(6);
  });

  it('does not call the network without a key or an enabled model', async () => {
    const { opts, calls } = options([]);
    expect(await runWithFallback({ ...opts, apiKey: undefined })).toMatchObject({ ok: false, errorType: 'not-configured' });
    expect(await runWithFallback({ ...opts, models: [] })).toMatchObject({ ok: false, errorType: 'model-unavailable' });
    expect(calls).toHaveLength(0);
  });

  it('stops starting new attempts once the whole-request limit is used up', async () => {
    const models = Array.from({ length: 20 }, (_, i) => `free/model-${i + 1}:free`);
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    // Every attempt "takes" 10 s and fails; with a 55 s budget only the first few models are tried.
    const slowFail = vi.fn(async () => { now += 10_000; return fail(503); }) as unknown as typeof fetch;
    try {
      const r = await runWithFallback({ ...options([]).opts, models, fetchImpl: slowFail, timeoutMs: 20_000, totalTimeoutMs: 55_000 });
      expect(r).toMatchObject({ ok: false, errorType: 'timeout' });
      expect(r.attempts.length).toBeLessThanOrEqual(6);
      expect(new Set(r.attempts.map((a) => a.model)).size).toBe(3);
    } finally {
      clock.mockRestore();
    }
  });

  it('reports the position of the answering model among twenty', async () => {
    const models = Array.from({ length: 20 }, (_, i) => `free/model-${i + 1}:free`);
    const { opts } = options([...Array.from({ length: 8 }, () => fail(502)), ok(JSON.stringify(GOOD))], { models, totalTimeoutMs: 55_000 });
    expect(await runWithFallback(opts)).toMatchObject({ ok: true, model: 'free/model-5:free', modelIndex: 4, usedFallback: true });
  });

  it('classifies HTTP statuses', () => {
    expect([401, 402, 408, 429, 500, 502, 503].map((s) => classifyStatus(s, ''))).toEqual(['auth', 'no-credit', 'request-timeout', 'rate-limited', 'server-error', 'bad-gateway', 'provider-unavailable']);
    expect(classifyStatus(400, 'qwen/x is not a valid model ID')).toBe('model-unavailable');
    expect(classifyStatus(400, 'bad json')).toBe('bad-request');
  });
});
