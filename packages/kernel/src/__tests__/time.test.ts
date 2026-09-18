import { describe, expect, it } from 'vitest';
import {
  ISODateSchema, IntervalSchema, asOf, interval, intervalContains, intervalDurationMs, intervalsOverlap,
  isoDate, supersede, toDate,
} from '../time';

const d = (s: string) => isoDate(s);

describe('ISODate', () => {
  it('normalizes Date and strings to UTC ISO', () => {
    expect(isoDate(new Date(Date.UTC(2026, 0, 2)))).toBe('2026-01-02T00:00:00.000Z');
    expect(isoDate('2026-01-02')).toBe('2026-01-02T00:00:00.000Z');
    expect(ISODateSchema.safeParse('not a date').success).toBe(false);
    expect(toDate(d('2026-01-02')).getTime()).toBe(Date.UTC(2026, 0, 2));
  });
});

describe('Interval', () => {
  it('is half-open and requires start < end', () => {
    const iv = interval(d('2026-01-01'), d('2026-01-31'));
    expect(intervalContains(iv, d('2026-01-01'))).toBe(true);
    expect(intervalContains(iv, d('2026-01-31'))).toBe(false);
    expect(IntervalSchema.safeParse({ start: d('2026-02-01'), end: d('2026-01-01') }).success).toBe(false);
  });
  it('open-ended intervals contain everything after start', () => {
    const iv = interval(d('2026-01-01'));
    expect(intervalContains(iv, d('2099-01-01'))).toBe(true);
    expect(() => intervalDurationMs(iv)).toThrow();
  });
  it('detects overlap', () => {
    const a = interval(d('2026-01-01'), d('2026-01-10'));
    const b = interval(d('2026-01-10'), d('2026-01-20'));
    const c = interval(d('2026-01-05'), d('2026-01-15'));
    expect(intervalsOverlap(a, b)).toBe(false);
    expect(intervalsOverlap(a, c)).toBe(true);
    expect(intervalDurationMs(a)).toBe(9 * 24 * 3600 * 1000);
  });
});

describe('Bitemporal asOf', () => {
  type Lien = { id: string; validFrom: string; validTo?: string; recordedAt: string; supersededAt?: string };
  // A lien filed (valid) on Jan 5 that we only learned about (recorded) on Jan 20.
  const rows: Lien[] = [
    { id: 'lien-1', validFrom: d('2026-01-05'), recordedAt: d('2026-01-20') },
  ];
  it('is invisible when asked as-of a recorded time before we knew', () => {
    expect(asOf(rows, { valid: d('2026-01-10'), recorded: d('2026-01-15') })).toBeUndefined();
  });
  it('is visible once recorded, for valid times at or after validFrom', () => {
    expect(asOf(rows, { valid: d('2026-01-10'), recorded: d('2026-01-21') })?.id).toBe('lien-1');
    expect(asOf(rows, { valid: d('2026-01-04'), recorded: d('2026-01-21') })).toBeUndefined();
  });
  it('picks the latest-recorded row when several are valid', () => {
    const corrected = supersede(rows[0]!, d('2026-01-25'));
    const v2: Lien = { id: 'lien-1-v2', validFrom: d('2026-01-05'), recordedAt: d('2026-01-25') };
    expect(asOf([corrected, v2], { valid: d('2026-01-10'), recorded: d('2026-01-26') })?.id).toBe('lien-1-v2');
    expect(asOf([corrected, v2], { valid: d('2026-01-10'), recorded: d('2026-01-22') })?.id).toBe('lien-1');
  });
});
