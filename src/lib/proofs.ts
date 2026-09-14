/** Proof images on an agent: a screenshot plus the Post URL it proves.
 *
 *  One rule for the browser, the mock API and the server. Images only — PNG,
 *  JPEG or WebP, identified by their bytes rather than their file name — and no
 *  larger than 500 KB. Post screenshots only: never identity documents. */

import { sanitizeUrl } from './sanitize';
import { postUrlKey } from './identity';
import { isAdmin } from './access';
import type { AgentProof, RoleName } from './types';

export const PROOF_MAX_BYTES = 500 * 1024;
export const PROOF_ACCEPT = 'image/png,image/jpeg,image/webp';
export type ProofMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** The real type from the first bytes, or null. A renamed file does not pass. */
export function sniffImageType(bytes: Uint8Array): ProofMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

export const formatKb = (bytes: number) => `${Math.ceil(bytes / 1024).toLocaleString()} KB`;

/** Size and type, before anything is sent. */
export function checkProofImage(bytes: Uint8Array): { mime: ProofMime } | { error: string } {
  if (!bytes.length) return { error: 'Choose an image.' };
  if (bytes.length > PROOF_MAX_BYTES) {
    return { error: `That image is ${formatKb(bytes.length)}. The limit is 500 KB — crop it or save it as JPEG and try again.` };
  }
  const mime = sniffImageType(bytes);
  if (!mime) return { error: 'Only PNG, JPEG or WebP images can be uploaded.' };
  return { mime };
}

/** The Post URL: required, a web link, normalised. */
export function checkProofPostUrl(raw: unknown): { value: string; key: string } | { error: string } {
  const value = sanitizeUrl(raw);
  const key = postUrlKey(value);
  if (!value || !key) return { error: 'Enter the Post URL, starting with https://' };
  return { value, key };
}

/** Base64 (optionally a data: URL) to bytes. Null when it is not valid base64. */
export function decodeBase64Image(input: unknown): Uint8Array | null {
  if (typeof input !== 'string') return null;
  const b64 = input.replace(/^data:[^;,]*;base64,/, '').replace(/\s/g, '');
  if (!b64 || b64.length > Math.ceil((PROOF_MAX_BYTES * 4) / 3) + 8) {
    // Over the limit before decoding: report it as too large, not as invalid.
    return b64 ? new Uint8Array(Math.floor((b64.length * 3) / 4)) : null;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/* ── Verdict and payment ─────────────────────────────────────────────────── */

export const PROOF_VERDICTS = ['Accepted', 'Rejected'] as const;
export const PROOF_PAYMENTS = ['Not paid', 'Paid'] as const;
export type ProofVerdict = NonNullable<AgentProof['verdict']>;
export type ProofPayment = AgentProof['payment'];
export const REJECT_REASON_MIN = 10;

/** Verdict and payment belong to the System Administrator alone — not a grantable permission. */
export const mayReviewProofs = (role: RoleName | undefined | null) => isAdmin(role);

export type ProofReviewInput = { verdict?: ProofVerdict; reason?: string; payment?: ProofPayment };

/** A review request: a known verdict and/or payment; a rejection needs a written reason. */
export function checkProofReview(raw: { verdict?: unknown; reason?: unknown; payment?: unknown }):
  { verdict?: ProofVerdict; reason: string; payment?: ProofPayment } | { error: string; field: string } {
  const out: { verdict?: ProofVerdict; reason: string; payment?: ProofPayment } = { reason: '' };
  if (raw.verdict !== undefined) {
    if (!PROOF_VERDICTS.includes(raw.verdict as ProofVerdict)) return { error: 'Verdict must be Accepted or Rejected.', field: 'verdict' };
    out.verdict = raw.verdict as ProofVerdict;
  }
  if (raw.payment !== undefined) {
    if (!PROOF_PAYMENTS.includes(raw.payment as ProofPayment)) return { error: 'Payment must be Paid or Not paid.', field: 'payment' };
    out.payment = raw.payment as ProofPayment;
  }
  if (!out.verdict && !out.payment) return { error: 'Choose a verdict or a payment status.', field: 'verdict' };
  const reason = typeof raw.reason === 'string' ? raw.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500) : '';
  if (out.verdict === 'Rejected' && reason.length < REJECT_REASON_MIN) {
    return { error: `Rejecting a proof needs a reason of at least ${REJECT_REASON_MIN} characters.`, field: 'reason' };
  }
  out.reason = out.verdict === 'Rejected' ? reason : '';
  return out;
}
