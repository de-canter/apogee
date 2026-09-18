import { describe, expect, it } from 'vitest';
import { add, allocate, money, moneyFromDecimal, multiply, toDecimalString } from '../../money';
import { interval, intervalDurationMs, isoDate } from '../../time';

const DAY = 24 * 3600 * 1000;

describe('Settlement proration (Texas, 365-day, seller pays through day before closing)', () => {
  const annualTax = moneyFromDecimal('7300.00', 'USD');
  const closing = isoDate('2026-03-15');
  const yearStart = isoDate('2026-01-01');

  it('splits annual tax by days with no lost pennies', () => {
    const sellerDays = intervalDurationMs(interval(yearStart, closing)) / DAY; // 73 days
    expect(sellerDays).toBe(73);
    const sellerShare = multiply(annualTax, sellerDays / 365);
    expect(toDecimalString(sellerShare)).toBe('1460.00');
    const buyerShare = allocate(annualTax, [sellerDays, 365 - sellerDays])[1]!;
    expect(add(sellerShare, buyerShare)).toEqual(annualTax);
  });

  it('allocates a $1,001.00 fee 70/30 between two underwriters exactly', () => {
    const [primary, secondary] = allocate(money(100100, 'USD'), [70, 30]);
    expect(toDecimalString(primary!)).toBe('700.70');
    expect(toDecimalString(secondary!)).toBe('300.30');
  });
});
