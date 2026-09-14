/** Password hashing and opaque token handling.
 *
 *  Two rules hold everywhere in this file:
 *    1. A password is never stored, logged, returned or compared as plaintext.
 *    2. A token is generated once, shown once, and only its SHA-256 is persisted —
 *       so a database dump yields no usable session or invite link. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { z } from 'zod';

/** OWASP's minimum recommended argon2id parameters (19 MiB, 2 passes).
 *
 *  The algorithm is left at the library default, which is Argon2id — its
 *  `Algorithm` enum cannot be imported under `verbatimModuleSyntax`, and a bare
 *  magic number would be worse than relying on a default that a test pins. */
const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

/** Verify a candidate against a stored hash.
 *
 *  Returns false rather than throwing on a malformed hash: a corrupt row must not
 *  turn into a 500 that tells an attacker the account exists. */
export async function verifyPassword(storedHash: string | null, candidate: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await argonVerify(storedHash, candidate);
  } catch {
    return false;
  }
}

/** A real hash over a throwaway secret, produced once per process.
 *
 *  It has to be genuinely valid: a hand-written placeholder would make `verify`
 *  fail its format check and return immediately, which is the opposite of the
 *  point. Generated lazily so the cost is paid on first use, not at import. */
let dummyHash: Promise<string> | null = null;

/** Burn roughly the cost of a real verification when there is no hash to check.
 *
 *  Without this, "unknown email" returns far faster than "wrong password", and
 *  that difference enumerates who has an account. */
export async function equaliseVerificationCost(): Promise<void> {
  dummyHash ??= argonHash(randomBytes(16).toString('hex'), ARGON_OPTIONS);
  await argonVerify(await dummyHash, 'not-the-password').catch(() => false);
}

/* ── Password policy ──────────────────────────────────────────── */

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200, 'That is longer than 200 characters.');

/** Words nobody should be building a password around. Long and unambiguous
 *  enough that plain containment is the right test. */
const BANNED_SUBSTRINGS = ['marketingcrm', 'password', 'qwerty', 'letmein', 'admin123'];

/** Shorter than this and an identity fragment is too common to filter on — with a
 *  two-letter name, rejecting every password containing it would reject most
 *  passwords. Three is the point where it stops being noise. */
const MIN_IDENTITY_TOKEN = 3;

/** How much password has to survive once the name or email is stripped out. */
const MIN_REMAINDER = 8;

/** Rejects passwords that are trivially derived from the account itself.
 *  A length rule alone happily accepts "marketingcrm2026" and "ana-ana-ana-ana". */
export function passwordProblem(password: string, context: { email: string; name: string }): string | null {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return parsed.error.issues[0].message;

  const lowered = password.toLowerCase();

  if (BANNED_SUBSTRINGS.some((b) => lowered.includes(b))) {
    return 'That contains a word which is too easy to guess.';
  }
  if (/^(.)\1+$/.test(password)) return 'That is a single character repeated.';

  // Measure how much of the password the identity accounts for, rather than
  // merely whether it appears. Containing your name is fine; being mostly your
  // name is not — and a containment test would have to skip short names
  // entirely, which is exactly where this team's names sit.
  const identityTokens = [context.email.split('@')[0] ?? '', context.name]
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length >= MIN_IDENTITY_TOKEN);

  for (const token of identityTokens) {
    const remainder = lowered.split(token).join('');
    if (remainder.length < MIN_REMAINDER) {
      return 'Too much of this is your own name or email address.';
    }
  }
  return null;
}

/* ── Opaque tokens (sessions, invites) ────────────────────────── */

export interface IssuedToken {
  /** Shown to the user once. Never stored. */
  token: string;
  /** Stored. Looking this up is how the token is validated. */
  hash: string;
}

export function issueToken(): IssuedToken {
  // 32 bytes is well past any feasible guessing attack, and base64url survives
  // being pasted into a URL without escaping.
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for the rare case where two known-length digests are
 *  compared directly rather than looked up by index. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
