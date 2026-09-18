import { z } from 'zod';
import { KernelError } from './errors';
import { roundTo, type RoundingMode } from './rounding';

export interface UnitDefinition { code: string; label: string; defaultPrecision: number }

export const UNITS: Readonly<Record<string, UnitDefinition>> = {
  each: { code: 'each', label: '', defaultPrecision: 0 },
  percent: { code: 'percent', label: '%', defaultPrecision: 2 },
  bp: { code: 'bp', label: 'bp', defaultPrecision: 0 },
  acre: { code: 'acre', label: 'ac', defaultPrecision: 3 },
  sqft: { code: 'sqft', label: 'sq ft', defaultPrecision: 0 },
  sqm: { code: 'sqm', label: 'm²', defaultPrecision: 2 },
  day: { code: 'day', label: 'days', defaultPrecision: 0 },
  month: { code: 'month', label: 'months', defaultPrecision: 0 },
};

export class UnitMismatchError extends KernelError {
  constructor(a: string, b: string) { super(`Unit mismatch: ${a} vs ${b}`, 'UNIT_MISMATCH'); }
}

/** Number + unit + precision (decimal places the value is meaningful to). */
export const QuantitySchema = z.object({
  value: z.number().finite(),
  unit: z.string().refine((u) => u in UNITS, { message: 'Unknown unit' }),
  precision: z.number().int().min(0).max(12),
});
export type Quantity = z.infer<typeof QuantitySchema>;

export function quantity(value: number, unit: string, precision?: number, mode: RoundingMode = 'HALF_UP'): Quantity {
  const def = UNITS[unit];
  if (!def) throw new KernelError(`Unknown unit: ${unit}`, 'UNKNOWN_UNIT');
  const p = precision ?? def.defaultPrecision;
  return QuantitySchema.parse({ value: roundTo(value, p, mode), unit, precision: p });
}

function assertSameUnit(a: Quantity, b: Quantity): void {
  if (a.unit !== b.unit) throw new UnitMismatchError(a.unit, b.unit);
}

export function addQuantity(a: Quantity, b: Quantity): Quantity {
  assertSameUnit(a, b);
  return quantity(a.value + b.value, a.unit, Math.min(a.precision, b.precision));
}
export function subtractQuantity(a: Quantity, b: Quantity): Quantity {
  assertSameUnit(a, b);
  return quantity(a.value - b.value, a.unit, Math.min(a.precision, b.precision));
}
export function scaleQuantity(q: Quantity, factor: number, mode: RoundingMode = 'HALF_UP'): Quantity {
  return quantity(q.value * factor, q.unit, q.precision, mode);
}
export function compareQuantity(a: Quantity, b: Quantity): -1 | 0 | 1 {
  assertSameUnit(a, b);
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}
export function formatQuantity(q: Quantity, locale = 'en-US'): string {
  const label = UNITS[q.unit]?.label ?? q.unit;
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: q.precision, maximumFractionDigits: q.precision }).format(q.value);
  return label ? `${n} ${label}` : n;
}
