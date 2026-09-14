/** The detail recorded beside a social account's recovery method.
 *
 *  What is stored is *which* recovery route exists — the recovery email or
 *  phone, the authenticator app and device, the security key's label — never
 *  the secret itself. Backup codes are the one method whose detail could be the
 *  secret, so for them only where the codes are kept is accepted, and anything
 *  that looks like the codes is refused. Standing rule: no passwords, tokens or
 *  recovery codes anywhere in this system. */

import type { RecoveryMethod } from './types';
import { sanitizeText } from './sanitize';
import { normalizePhone } from './utils';

export const RECOVERY_DETAIL_MAX = 200;

export const RECOVERY_DETAIL_HELP: Record<RecoveryMethod, { label: string; placeholder: string; hint: string }> = {
  'Recovery Email': { label: 'Recovery email', placeholder: 'recovery.inbox@example.com', hint: 'The email address the platform sends recovery links to.' },
  'Recovery Phone': { label: 'Recovery phone number', placeholder: '+63 917 555 0420', hint: 'The number the platform texts recovery codes to.' },
  'Authenticator App': { label: 'Authenticator app and device', placeholder: "Google Authenticator on Ana's phone", hint: 'Which app, on whose device. Never the setup key or a code.' },
  'Backup Codes': { label: 'Where the backup codes are kept', placeholder: 'vault://marketing/recovery/acc-0231', hint: 'Where to find them. Never type the codes themselves.' },
  'Security Key': { label: 'Security key label', placeholder: 'YubiKey #3 (office safe)', hint: 'The key’s label and where it is kept.' },
  None: { label: 'Recovery detail', placeholder: '', hint: 'Choose a recovery method first.' },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Groups of 6+ letters/digits containing at least three digits, e.g. "8391-2274"
 *  or "k3x9p2m7", or a run of six or more digits: the shape of backup codes, setup
 *  keys and one-time codes. */
function looksLikeCodes(text: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim())) return false; // a vault or web reference
  const groups = text.split(/[\s,;]+/).filter((t) => {
    const compact = t.replace(/-/g, '');
    return /^[a-z0-9]{6,}$/i.test(compact) && (compact.match(/\d/g) ?? []).length >= 3;
  });
  // Or six or more digits in a run, however they are spaced: "8391 2274".
  return groups.length >= 1 || /(?:\d[\s-]?){6,}/.test(text);
}

/** Normalises the detail for the chosen method, or explains why it is refused. */
export function checkRecoveryDetail(method: RecoveryMethod | undefined, raw: unknown): { value: string } | { error: string } {
  const text = sanitizeText(raw, RECOVERY_DETAIL_MAX);
  if (!method || method === 'None') return { value: '' };
  if (!text) return { value: '' };
  switch (method) {
    case 'Recovery Email':
      return EMAIL.test(text) ? { value: text.toLowerCase() } : { error: 'Enter the recovery email address, e.g. name@example.com.' };
    case 'Recovery Phone': {
      const phone = normalizePhone(text);
      const digits = phone.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15 ? { value: phone } : { error: 'Enter the recovery phone number with its country code.' };
    }
    case 'Backup Codes':
      return looksLikeCodes(text)
        ? { error: 'That looks like the backup codes themselves. Write where they are kept instead — codes are never stored here.' }
        : { value: text };
    case 'Authenticator App':
      return looksLikeCodes(text)
        ? { error: 'That looks like a code or setup key. Describe the app, device or key instead — secrets are never stored here.' }
        : { value: text };
    default:
      return { value: text };
  }
}
