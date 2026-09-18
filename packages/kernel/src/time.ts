import { z } from 'zod';
import { KernelError } from './errors';

/** Stored dates are ISO 8601 strings so every shape is JSON-safe. Branded to keep raw strings out. */
export const ISODateSchema = z.iso.datetime({ offset: true }).brand<'ISODate'>();
export type ISODate = z.infer<typeof ISODateSchema>;

export function isoDate(input: Date | string): ISODate {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) throw new KernelError(`Invalid date: ${String(input)}`, 'INVALID_DATE');
  return ISODateSchema.parse(dt.toISOString());
}
export function nowIso(): ISODate {
  return isoDate(new Date());
}
export function toDate(iso: ISODate): Date {
  return new Date(iso);
}
function ms(iso: string): number {
  return new Date(iso).getTime();
}

/** Half-open `[start, end)`; absent `end` means open-ended. */
export const IntervalSchema = z
  .object({ start: ISODateSchema, end: ISODateSchema.optional() })
  .refine((iv) => iv.end === undefined || ms(iv.start) < ms(iv.end), { message: 'start must be before end' });
export type Interval = z.infer<typeof IntervalSchema>;

export function interval(start: ISODate, end?: ISODate): Interval {
  return IntervalSchema.parse(end === undefined ? { start } : { start, end });
}
export function intervalContains(iv: Interval, at: ISODate): boolean {
  const t = ms(at);
  return t >= ms(iv.start) && (iv.end === undefined || t < ms(iv.end));
}
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  const aEnd = a.end === undefined ? Number.POSITIVE_INFINITY : ms(a.end);
  const bEnd = b.end === undefined ? Number.POSITIVE_INFINITY : ms(b.end);
  return ms(a.start) < bEnd && ms(b.start) < aEnd;
}
export function intervalDurationMs(iv: Interval): number {
  if (iv.end === undefined) throw new KernelError('Open-ended interval has no duration', 'OPEN_INTERVAL');
  return ms(iv.end) - ms(iv.start);
}

/** Valid time = when it was true in the world; record time = when we learned it. */
export const BitemporalSchema = z.object({
  validFrom: ISODateSchema,
  validTo: ISODateSchema.optional(),
  recordedAt: ISODateSchema,
  supersededAt: ISODateSchema.optional(),
});
export type Bitemporal = z.infer<typeof BitemporalSchema>;

/** Structural, unbranded form so plain rows from a store can be queried. */
export interface BitemporalLike {
  validFrom: string;
  validTo?: string;
  recordedAt: string;
  supersededAt?: string;
}

export interface AsOfOptions { valid: ISODate; recorded?: ISODate }

/**
 * The row that was true at `valid`, as known at `recorded` (default now).
 * Among candidates, the most recently recorded wins.
 */
export function asOf<T extends BitemporalLike>(rows: readonly T[], opts: AsOfOptions): T | undefined {
  const v = ms(opts.valid);
  const r = opts.recorded === undefined ? Date.now() : ms(opts.recorded);
  let best: T | undefined;
  for (const row of rows) {
    const known = ms(row.recordedAt) <= r && (row.supersededAt === undefined || ms(row.supersededAt) > r);
    const trueThen = ms(row.validFrom) <= v && (row.validTo === undefined || ms(row.validTo) > v);
    if (known && trueThen && (best === undefined || ms(row.recordedAt) > ms(best.recordedAt))) best = row;
  }
  return best;
}

export function supersede<T extends BitemporalLike>(row: T, at: ISODate): T {
  if (row.supersededAt !== undefined) throw new KernelError('Row already superseded', 'ALREADY_SUPERSEDED');
  return { ...row, supersededAt: at };
}
