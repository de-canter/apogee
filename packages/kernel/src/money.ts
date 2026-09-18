import { z } from 'zod';
import { KernelError } from './errors';
import { roundTo, type RoundingMode } from './rounding';

/** ISO 4217 minor-unit scale. Extend as products need. */
const CURRENCY_SCALE: Readonly<Record<string, number>> = {
  USD: 2, CAD: 2, EUR: 2, GBP: 2, AUD: 2, MXN: 2, JPY: 0, KWD: 3,
};

export class UnknownCurrencyError extends KernelError {
  constructor(code: string) { super(`Unknown currency: ${code}`, 'UNKNOWN_CURRENCY'); }
}
export class CurrencyMismatchError extends KernelError {
  constructor(a: string, b: string) { super(`Currency mismatch: ${a} vs ${b}`, 'CURRENCY_MISMATCH'); }
}

export function currencyScale(code: string): number {
  const scale = CURRENCY_SCALE[code];
  if (scale === undefined) throw new UnknownCurrencyError(code);
  return scale;
}

/** Integer minor units (cents for USD) + ISO 4217 code. Never a float. */
export const MoneySchema = z.object({
  minor: z.number().int().safe(),
  currency: z.string().length(3).refine((c) => c in CURRENCY_SCALE, { message: 'Unknown currency' }),
});
export type Money = z.infer<typeof MoneySchema>;

export function money(minor: number, currency: string): Money {
  currencyScale(currency);
  return MoneySchema.parse({ minor, currency });
}

export function moneyFromDecimal(amount: string | number, currency: string, mode: RoundingMode = 'HALF_UP'): Money {
  const scale = currencyScale(currency);
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new KernelError(`Invalid amount: ${String(amount)}`, 'INVALID_AMOUNT');
  return money(Math.round(roundTo(n, scale, mode) * 10 ** scale), currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}
export function negate(m: Money): Money {
  return money(-m.minor, m.currency);
}
export function isZero(m: Money): boolean {
  return m.minor === 0;
}
export function multiply(m: Money, ratio: number, mode: RoundingMode = 'HALF_UP'): Money {
  return money(roundTo(m.minor * ratio, 0, mode), m.currency);
}
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

/** Split `m` across `weights` using largest-remainder; parts always sum to `m.minor`. */
export function allocate(m: Money, weights: number[]): Money[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0 || total <= 0 || weights.some((w) => w < 0)) {
    throw new KernelError('allocate requires non-negative weights with a positive sum', 'INVALID_WEIGHTS');
  }
  const raw = weights.map((w) => (m.minor * w) / total);
  const floors = raw.map((r) => Math.trunc(r));
  let remainder = m.minor - floors.reduce((s, f) => s + f, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.trunc(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = remainder < 0 ? -1 : 1;
  for (const { i } of order) {
    if (remainder === 0) break;
    floors[i] = (floors[i] ?? 0) + step;
    remainder -= step;
  }
  return floors.map((f) => money(f, m.currency));
}

export function toDecimalString(m: Money): string {
  const scale = currencyScale(m.currency);
  const sign = m.minor < 0 ? '-' : '';
  const abs = Math.abs(m.minor).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${abs}`;
  return `${sign}${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
}

export function formatMoney(m: Money, locale = 'en-US'): string {
  const scale = currencyScale(m.currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: m.currency, minimumFractionDigits: scale, maximumFractionDigits: scale,
  }).format(m.minor / 10 ** scale);
}
