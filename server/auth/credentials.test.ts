import { describe, expect, it } from 'vitest';
import {
  hashPassword, hashToken, issueToken, passwordProblem, tokensMatch, verifyPassword,
} from './credentials';

describe('password hashing', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('a-perfectly-fine-password');
    // Pins the algorithm, since it is taken from the library default rather than
    // named explicitly — this is the test that would catch it changing.
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
  });

  it('never returns the password itself', async () => {
    const password = 'a-perfectly-fine-password';
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-twice'), hashPassword('same-password-twice')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'same-password-twice')).toBe(true);
    expect(await verifyPassword(b, 'same-password-twice')).toBe(true);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct-horse-batterX')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('returns false rather than throwing on a missing or corrupt hash', async () => {
    // A corrupt row must not become a 500 that confirms the account exists.
    expect(await verifyPassword(null, 'anything')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('$argon2id$garbage', 'anything')).toBe(false);
  });
});

describe('password policy', () => {
  const context = { email: 'ana@example.test', name: 'Ana' };

  it('accepts a reasonable password', () => {
    expect(passwordProblem('quiet-anchor-lantern', context)).toBeNull();
  });

  it('requires real length', () => {
    expect(passwordProblem('short', context)).toMatch(/at least 12/);
  });

  it('rejects one that is mostly the account name — including short names', () => {
    // Three-letter names like Ana and Bea are exactly where a naive
    // "length >= 4" guard would silently skip the check.
    expect(passwordProblem('ana-ana-ana-ana', context)).toMatch(/your own name or email/);
    expect(passwordProblem('anaanaanaanaana', context)).toMatch(/your own name or email/);
  });

  it('allows a strong password that merely contains the name', () => {
    // Containing your name is fine; being mostly your name is not.
    expect(passwordProblem('quiet-ana-anchor-lantern', context)).toBeNull();
  });

  it('rejects easily guessed words', () => {
    expect(passwordProblem('marketingcrm2026', context)).toMatch(/too easy to guess/);
    expect(passwordProblem('mypassword1234', context)).toMatch(/too easy to guess/);
    expect(passwordProblem('qwertyqwerty12', context)).toMatch(/too easy to guess/);
  });

  it('rejects a single repeated character', () => {
    expect(passwordProblem('aaaaaaaaaaaaaa', context)).toMatch(/single character repeated/);
  });

  it('is case-insensitive about the account name', () => {
    expect(passwordProblem('ANAANAANAANA', context)).toMatch(/your own name or email/);
  });

  it('checks the email local part too, not just the name', () => {
    const other = { email: 'marwin.editor@example.test', name: 'Marwin' };
    expect(passwordProblem('marwin.editormarwin.editor', other)).toMatch(/your own name or email/);
  });
});

describe('opaque tokens', () => {
  it('issues a high-entropy token and stores only its hash', () => {
    const { token, hash } = issueToken();
    expect(token.length).toBeGreaterThanOrEqual(43);   // 32 bytes, base64url
    expect(hash).toHaveLength(64);                     // sha256 hex
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it('is URL-safe, so an invite link needs no escaping', () => {
    for (let i = 0; i < 20; i++) {
      expect(issueToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => issueToken().token));
    expect(seen.size).toBe(200);
  });

  it('compares digests without leaking length or content through timing', () => {
    const { hash } = issueToken();
    expect(tokensMatch(hash, hash)).toBe(true);
    expect(tokensMatch(hash, hashToken('something-else'))).toBe(false);
    expect(tokensMatch(hash, 'short')).toBe(false);
  });
});
