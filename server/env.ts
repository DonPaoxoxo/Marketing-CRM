/** Server configuration, validated once at startup.
 *
 *  A missing or malformed value fails loudly here rather than surfacing as a
 *  confusing runtime error later. Nothing in this file has a default that would
 *  be unsafe in production — notably there is no fallback session secret, because
 *  a shared default secret is the same as no secret at all. */

import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** The interface to listen on. Loopback by default: in production the only
   *  thing that should reach this port is the reverse proxy on the same machine,
   *  which terminates HTTPS. Listening on every interface would put a plain-HTTP
   *  copy of the whole workspace one firewall rule away from the internet. */
  HOST: z.string().min(1).default('127.0.0.1'),
  /** How many reverse proxies sit in front of the app, so the visitor's real
   *  address is read that many hops back in X-Forwarded-For. 1 for nginx alone;
   *  2 for Cloudflare in front of nginx. Too low and every visitor appears to be
   *  the proxy — they share one sign-in rate limit, so strangers can use up the
   *  team's attempts. Too high and a visitor can spoof their address. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),

  /** Used to sign the session cookie. At least 32 characters of real randomness. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  /** How long a session stays valid without activity. */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
  /** How long an invite link remains usable. */
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).default(72),

  /** Where the browser app is served from, for cookie and CORS scope. */
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** OpenRouter key for the AI Assistant Learner. Server side only: never sent to
   *  the browser, logged or stored. Without it the assistant reports "not configured". */
  OPENROUTER_API_KEY: z.string().min(10).optional(),

  /** Set true when serving over HTTPS so the session cookie is marked Secure. */
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === undefined ? undefined : v !== 'false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  // Never echo the values — only which keys are wrong.
  console.error(`Invalid server configuration:\n${problems}\n\nSee .env.example.`);
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

export const env = {
  ...raw,
  isProduction,
  /** Default to Secure cookies in production unless explicitly overridden. */
  cookieSecure: raw.COOKIE_SECURE ?? isProduction,
} as const;

export type Env = typeof env;
