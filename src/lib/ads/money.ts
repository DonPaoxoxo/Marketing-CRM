/** Money for Ads Monitoring: exact decimals, never floating-point sums.
 *
 *  Amounts are stored as DECIMAL(18,4) and handled here as integers of
 *  1/10,000ths of a unit (bigint), so adding a thousand daily spends gives
 *  exactly the total the spreadsheet shows. Ratios (CPM, cost per click) are
 *  computed from those exact totals and only then turned into a number for
 *  display. */

export type CurrencyCode = 'INR' | 'PHP' | 'USD' | 'CNY' | 'VND';

export const CURRENCIES: readonly { code: CurrencyCode; label: string; symbol: string; decimals: number }[] = [
  { code: 'INR', label: 'Indian Rupee (INR)', symbol: '₹', decimals: 2 },
  { code: 'PHP', label: 'Philippine Peso (PHP)', symbol: '₱', decimals: 2 },
  { code: 'USD', label: 'US Dollar (USD)', symbol: '$', decimals: 2 },
  { code: 'CNY', label: 'Chinese Yuan / Renminbi (CNY / RMB)', symbol: '¥', decimals: 2 },
  // Shown without decimals; internal precision is kept for calculated costs.
  { code: 'VND', label: 'Vietnamese Dong (VND)', symbol: '₫', decimals: 0 },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

/** "rmb", "Renminbi", "yuan" and "CNY" are one currency: CNY. */
export function normalizeCurrency(raw: unknown): CurrencyCode | null {
  const text = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!text) return null;
  if (text === 'RMB' || text === 'RENMINBI' || text === 'YUAN' || text === 'CNYRMB') return 'CNY';
  if (text === 'PESO') return 'PHP';
  if (text === 'RUPEE') return 'INR';
  if (text === 'DONG') return 'VND';
  return (CURRENCY_CODES as string[]).includes(text) ? (text as CurrencyCode) : null;
}

export const SCALE = 10_000n;
const MAX_UNITS = 99_999_999_999_999n * SCALE; // DECIMAL(18,4)

/** A plain amount ("1147.64", 1147.64) as exact units. No currency symbols or
 *  thousands separators: "1,147.64" is refused rather than guessed at. */
export function parseAmount(raw: unknown): { units: bigint } | { error: string } | null {
  if (raw === null || raw === undefined) return null;
  let text = typeof raw === 'number' ? (Number.isFinite(raw) ? raw.toFixed(8) : 'x') : String(raw).trim();
  if (text === '') return null;
  if (/[,\s]/.test(text.trim())) return { error: 'Write the amount without thousands separators, e.g. 1147.64.' };
  if (/[^\d.\-+eE]/.test(text)) return { error: 'Write the amount as a number only, without a currency symbol.' };
  if (/e/i.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return { error: 'Not a number.' };
    text = n.toFixed(8);
  }
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return { error: 'Not a number.' };
  if (match[1] === '-') return { error: 'Amounts cannot be negative.' };
  const fraction = (match[3] ?? '').padEnd(4, '0');
  // Beyond 4 decimal places is rounded half-up, the way the database would store it.
  let units = BigInt(match[2] || '0') * SCALE + BigInt(fraction.slice(0, 4));
  if (fraction.length > 4 && Number(fraction[4]) >= 5) units += 1n;
  if (units > MAX_UNITS) return { error: 'That amount is too large.' };
  return { units };
}

/** Units back to the DECIMAL(18,4) string the database stores. */
export function unitsToDecimal(units: bigint): string {
  const whole = units / SCALE;
  const frac = (units % SCALE).toString().padStart(4, '0');
  return `${whole}.${frac}`;
}

/** A DECIMAL string from the database as units. */
export const decimalToUnits = (value: string | number | null | undefined): bigint | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseAmount(value);
  return parsed && 'units' in parsed ? parsed.units : null;
};

/** Exact units as a JS number, for ratios and charts only. */
export const unitsToNumber = (units: bigint): number => Number(units) / Number(SCALE);

export function currencyInfo(code: CurrencyCode) {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/** "₱1,147.64", "₫2,500,000". `precise` keeps two decimals even for VND, for per-unit costs. */
export function formatMoney(value: bigint | number | null | undefined, currency: CurrencyCode, opts: { precise?: boolean } = {}): string {
  if (value === null || value === undefined) return 'N/A';
  const n = typeof value === 'bigint' ? unitsToNumber(value) : value;
  if (!Number.isFinite(n)) return 'N/A';
  const info = currencyInfo(currency);
  const decimals = info.decimals === 0 && opts.precise ? 2 : info.decimals;
  return `${info.symbol}${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
