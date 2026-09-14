/** OpenRouter chat completions, server side only, with model fallback.
 *
 *  Follows the official quickstart (https://openrouter.ai/docs/quickstart):
 *  POST https://openrouter.ai/api/v1/chat/completions with a Bearer key and the
 *  optional HTTP-Referer / X-Title attribution headers. The key comes from the
 *  OPENROUTER_API_KEY environment variable and is never logged, stored or sent to
 *  the browser.
 *
 *  Order: each enabled model in turn. A model is retried with exponential backoff
 *  on timeouts, 408, 429, 500, 502 and 503; an invalid JSON reply gets one
 *  correction retry; then the next model is tried. 401/403 stop everything (the
 *  key is wrong); 402 (no credit) and "model not found" move straight on. */

import { JSON_CORRECTION, parseAiReply, type AiSuggestion } from '../../src/lib/spiel-ai';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export type ErrorType =
  | 'timeout' | 'rate-limited' | 'no-credit' | 'server-error' | 'provider-unavailable' | 'bad-gateway'
  | 'request-timeout' | 'model-unavailable' | 'auth' | 'bad-request' | 'empty' | 'malformed-json' | 'schema' | 'network' | 'not-configured';

export interface Attempt {
  model: string;
  outcome: 'success' | 'error';
  errorType: ErrorType | '';
  httpStatus: number | null;
  durationMs: number;
  usage: { prompt: number | null; completion: number | null; total: number | null };
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface RunOptions {
  apiKey: string | undefined;
  models: string[];
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Stop starting new attempts once this much time has passed for the whole request. */
  totalTimeoutMs?: number;
  appOrigin: string;
  /** Retries per model for transient failures (not counting the JSON correction). */
  retriesPerModel?: number;
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export type RunResult =
  | { ok: true; suggestion: AiSuggestion; model: string; modelIndex: number; usedFallback: boolean; attempts: Attempt[] }
  | { ok: false; errorType: ErrorType; message: string; attempts: Attempt[] };

const TRANSIENT: ErrorType[] = ['timeout', 'rate-limited', 'server-error', 'provider-unavailable', 'bad-gateway', 'request-timeout', 'network'];

export function classifyStatus(status: number, bodyText: string): ErrorType {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'no-credit';
  if (status === 408) return 'request-timeout';
  if (status === 429) return 'rate-limited';
  if (status === 502) return 'bad-gateway';
  if (status === 503) return 'provider-unavailable';
  if (status >= 500) return 'server-error';
  if (status === 404 || (status === 400 && /model|not a valid|no endpoints|not found|unavailable/i.test(bodyText))) return 'model-unavailable';
  return 'bad-request';
}

export const USER_MESSAGES: Record<ErrorType, string> = {
  timeout: 'The AI took too long to answer. Your text is unchanged — try again in a moment.',
  'request-timeout': 'The AI service timed out. Your text is unchanged — try again in a moment.',
  'rate-limited': 'The AI models are busy or rate-limited right now. Your text is unchanged — try again in a minute.',
  'no-credit': 'The AI service account has no credit for these models. Ask the System Administrator to check the OpenRouter account or the model settings.',
  'server-error': 'The AI service had a problem. Your text is unchanged — try again shortly.',
  'bad-gateway': 'The AI provider could not be reached. Your text is unchanged — try again shortly.',
  'provider-unavailable': 'The AI provider is at capacity. Your text is unchanged — try again shortly.',
  'model-unavailable': 'The configured AI models are not available. Ask the System Administrator to update the model settings.',
  auth: 'The AI service rejected the server key. Ask the System Administrator to check OPENROUTER_API_KEY.',
  'bad-request': 'The AI service could not process this request. Try shorter text.',
  empty: 'The AI returned an empty answer. Your text is unchanged — try again.',
  'malformed-json': 'The AI answer could not be read. Your text is unchanged — try again.',
  schema: 'The AI answer was incomplete. Your text is unchanged — try again.',
  network: 'Could not reach the AI service. Your text is unchanged — try again.',
  'not-configured': 'The AI Assistant is not configured on this server yet. Ask the System Administrator to set OPENROUTER_API_KEY.',
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface CallOutcome { attempt: Attempt; content?: string }

async function callOnce(opts: RunOptions, model: string, messages: ChatMessage[]): Promise<CallOutcome> {
  const fetcher = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const started = Date.now();
  const base = { model, httpStatus: null as number | null, usage: { prompt: null, completion: null, total: null } as Attempt['usage'] };
  try {
    const res = await fetcher(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': opts.appOrigin,
        'X-Title': 'Marketing CRM - AI Assistant Learner',
      },
      body: JSON.stringify({ model, messages, temperature: opts.temperature, max_tokens: opts.maxTokens }),
    });
    const text = await res.text();
    const durationMs = Date.now() - started;
    if (!res.ok) {
      return { attempt: { ...base, outcome: 'error', errorType: classifyStatus(res.status, text), httpStatus: res.status, durationMs } };
    }
    let json: { choices?: { message?: { content?: unknown }; finish_reason?: string; error?: { code?: number } }[]; error?: { code?: number; message?: string }; usage?: Record<string, number> };
    try { json = JSON.parse(text); } catch {
      return { attempt: { ...base, outcome: 'error', errorType: 'server-error', httpStatus: res.status, durationMs } };
    }
    const usage = { prompt: json.usage?.prompt_tokens ?? null, completion: json.usage?.completion_tokens ?? null, total: json.usage?.total_tokens ?? null };
    // OpenRouter can report a provider failure inside a 200 response.
    const inlineError = json.error ?? json.choices?.[0]?.error;
    if (inlineError) {
      const code = Number(inlineError.code) || 502;
      return { attempt: { ...base, usage, outcome: 'error', errorType: classifyStatus(code, String((inlineError as { message?: string }).message ?? '')), httpStatus: code, durationMs } };
    }
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { attempt: { ...base, usage, outcome: 'error', errorType: 'empty', httpStatus: res.status, durationMs } };
    }
    return { attempt: { ...base, usage, outcome: 'success', errorType: '', httpStatus: res.status, durationMs }, content };
  } catch (error) {
    const aborted = (error as { name?: string }).name === 'AbortError';
    return { attempt: { ...base, outcome: 'error', errorType: aborted ? 'timeout' : 'network', durationMs: Date.now() - started } };
  } finally {
    clearTimeout(timer);
  }
}

/** Try each model in order until one returns a valid structured reply. */
export async function runWithFallback(opts: RunOptions): Promise<RunResult> {
  const attempts: Attempt[] = [];
  if (!opts.apiKey) return { ok: false, errorType: 'not-configured', message: USER_MESSAGES['not-configured'], attempts };
  const models = opts.models.filter(Boolean);
  if (!models.length) return { ok: false, errorType: 'model-unavailable', message: 'No AI model is enabled. Ask the System Administrator to enable one.', attempts };
  const sleep = opts.sleep ?? defaultSleep;
  const retries = opts.retriesPerModel ?? 1;
  const base = opts.backoffBaseMs ?? 800;
  let lastError: ErrorType = 'server-error';
  const started = Date.now();
  const deadline = opts.totalTimeoutMs ? started + opts.totalTimeoutMs : Number.POSITIVE_INFINITY;
  // Each attempt gets its own timeout, but never more than the time left for the whole request.
  const withBudget = () => ({ ...opts, timeoutMs: Math.max(1000, Math.min(opts.timeoutMs, deadline - Date.now())) });
  const outOfTime = () => Date.now() >= deadline - 1000;

  for (const [index, model] of models.entries()) {
    let transientTries = 0;
    let corrected = false;
    let messages = opts.messages;
    if (outOfTime()) { lastError = 'timeout'; break; }
    for (;;) {
      if (outOfTime()) { lastError = 'timeout'; break; }
      const { attempt, content } = await callOnce(withBudget(), model, messages);
      if (attempt.outcome === 'success') {
        const parsed = parseAiReply(content);
        if (parsed.ok) {
          attempts.push(attempt);
          return { ok: true, suggestion: parsed.value, model, modelIndex: index, usedFallback: index > 0, attempts };
        }
        attempts.push({ ...attempt, outcome: 'error', errorType: parsed.error });
        lastError = parsed.error;
        if (!corrected) {
          // One correction retry on the same model, showing it what it sent.
          corrected = true;
          messages = [...opts.messages, { role: 'assistant', content: String(content).slice(0, 4000) }, { role: 'user', content: JSON_CORRECTION }];
          continue;
        }
        break;
      }
      attempts.push(attempt);
      lastError = attempt.errorType as ErrorType;
      if (lastError === 'auth') return { ok: false, errorType: 'auth', message: USER_MESSAGES.auth, attempts };
      if (TRANSIENT.includes(lastError) && transientTries < retries) {
        transientTries++;
        // Exponential backoff with jitter: base, 2×base, … capped at 8 s.
        await sleep(Math.min(8000, base * 2 ** (transientTries - 1)) + Math.floor(Math.random() * 250));
        continue;
      }
      break;
    }
  }
  return { ok: false, errorType: lastError, message: USER_MESSAGES[lastError] ?? USER_MESSAGES['server-error'], attempts };
}

/** Which configured model ids OpenRouter currently lists. Null when the list could not be fetched. */
export async function checkModelAvailability(ids: string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, boolean> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { id?: string }[] };
    const listed = new Set((json.data ?? []).map((m) => m.id));
    return Object.fromEntries(ids.map((id) => [id, listed.has(id)]));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
