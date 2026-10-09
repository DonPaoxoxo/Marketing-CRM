/** Display and outreach helpers for Data Leads.
 *
 *  `publicTelegram`/`publicInstagram` are scraped free text, not a normalised
 *  handle like a SIM's — "Telegram channel; t.me/dkonlinetech" is a real value
 *  in the wild. These pull out a clickable link where one is findable and never
 *  reject or rewrite the stored text. */

import { sanitizeUrl } from './sanitize';
import type { DataLeadRecord } from './types';

const TELEGRAM_LINK = /(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\/([a-z0-9_]{3,32})/i;
const INSTAGRAM_LINK = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-z0-9._]{1,30})/i;

export function telegramLinkIn(text: string): string {
  const m = TELEGRAM_LINK.exec(text);
  return m ? sanitizeUrl(`https://t.me/${m[1]}`) : '';
}

export function instagramLinkIn(text: string): string {
  const m = INSTAGRAM_LINK.exec(text);
  return m ? sanitizeUrl(`https://instagram.com/${m[1]}`) : '';
}

/** A mailto: link to open the person's own email client, never sent through
 *  this app. Returns '' when there is no usable address. */
export function leadMailto(lead: Pick<DataLeadRecord, 'publicEmail' | 'creator'>): string {
  const email = lead.publicEmail.trim().split(/[;,\s]+/)[0] ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  const subject = encodeURIComponent(`Quick question for ${lead.creator}`);
  return `mailto:${encodeURIComponent(email)}?subject=${subject}`;
}

/** The best outreach channel for a lead, in contact-quality order. `kind` says
 *  which one, so the caller can label the action and warn before the fallback. */
export function bestOutreachLink(lead: DataLeadRecord): { kind: 'email' | 'telegram' | 'instagram'; href: string } | null {
  const mailto = leadMailto(lead);
  if (mailto) return { kind: 'email', href: mailto };
  const telegram = telegramLinkIn(lead.publicTelegram);
  if (telegram) return { kind: 'telegram', href: telegram };
  const instagram = instagramLinkIn(lead.publicInstagram);
  if (instagram) return { kind: 'instagram', href: instagram };
  return null;
}

export const PROMO_CONFIDENCE_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  high: 'success', medium: 'warning', low: 'danger', review: 'neutral',
};

export const promoConfidenceTone = (value: string): 'success' | 'warning' | 'neutral' | 'danger' =>
  PROMO_CONFIDENCE_TONE[value.trim().toLowerCase()] ?? 'neutral';
