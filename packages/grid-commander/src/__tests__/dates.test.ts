import { describe, it, expect, afterEach, vi } from 'vitest';
import { daysUntil, daysSince, isToday, formatDate } from '../utils/dates';

const now = () => new Date();

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    expect(daysUntil(new Date(), now())).toBe(0);
  });

  it('returns positive for future dates', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    expect(daysUntil(future, now())).toBe(5);
  });

  it('returns negative for past dates', () => {
    const past = new Date();
    past.setDate(past.getDate() - 3);
    expect(daysUntil(past, now())).toBe(-3);
  });
});

describe('daysSince', () => {
  it('returns 0 for today', () => {
    expect(daysSince(new Date(), now())).toBe(0);
  });

  it('returns positive for past dates', () => {
    const past = new Date();
    past.setDate(past.getDate() - 7);
    expect(daysSince(past, now())).toBe(7);
  });
});

describe('isToday', () => {
  it('returns true for today', () => {
    expect(isToday(new Date(), now())).toBe(true);
  });

  it('returns false for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday, now())).toBe(false);
  });
});

describe('formatDate', () => {
  it('formats as MM/DD/YY', () => {
    const date = new Date(2025, 2, 15); // March 15, 2025
    expect(formatDate(date)).toBe('03/15/25');
  });

  it('accepts ISO strings', () => {
    expect(formatDate('2025-01-05T00:00:00.000Z')).toMatch(/01\/0[45]\/25/);
  });
});

describe('date-only strings (F783)', () => {
  const zones = ['America/Chicago', 'UTC', 'Pacific/Honolulu', 'Asia/Tokyo'];
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(zones)('formatDate keeps YYYY-MM-DD on its day in %s', (zone) => {
    vi.stubEnv('TZ', zone);
    expect(formatDate('2026-09-29')).toBe('09/29/26');
    expect(formatDate('2026-01-01')).toBe('01/01/26');
  });

  it.each(zones)('daysUntil counts a YYYY-MM-DD string from local today in %s', (zone) => {
    vi.stubEnv('TZ', zone);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(daysUntil(today, now)).toBe(0);
    expect(isToday(today, now)).toBe(true);
  });
});


