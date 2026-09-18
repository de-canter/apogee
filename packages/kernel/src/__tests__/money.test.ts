import { describe, expect, it } from 'vitest';
import { roundTo } from '../rounding';
import {
  MoneySchema, add, allocate, compareMoney, formatMoney, money, moneyFromDecimal,
  multiply, subtract, toDecimalString, CurrencyMismatchError, UnknownCurrencyError,
} from '../money';

describe('roundTo', () => {
  it('HALF_UP is the default and rounds .5 away from zero', () => {
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(1.005, 2)).toBe(1.01);
  });
  it('HALF_EVEN rounds to even', () => {
    expect(roundTo(2.5, 0, 'HALF_EVEN')).toBe(2);
    expect(roundTo(3.5, 0, 'HALF_EVEN')).toBe(4);
  });
  it('DOWN truncates toward zero, UP away from zero', () => {
    expect(roundTo(2.9, 0, 'DOWN')).toBe(2);
    expect(roundTo(-2.9, 0, 'DOWN')).toBe(-2);
    expect(roundTo(2.1, 0, 'UP')).toBe(3);
  });
});

describe('Money', () => {
  it('constructs from decimal string without float drift', () => {
    expect(moneyFromDecimal('0.10', 'USD')).toEqual({ minor: 10, currency: 'USD' });
    expect(moneyFromDecimal('1234.567', 'USD')).toEqual({ minor: 123457, currency: 'USD' });
    expect(moneyFromDecimal(19.99, 'USD')).toEqual({ minor: 1999, currency: 'USD' });
  });
  it('rejects non-integer minor units and unknown currencies', () => {
    expect(MoneySchema.safeParse({ minor: 1.5, currency: 'USD' }).success).toBe(false);
    expect(() => money(100, 'XXX')).toThrow(UnknownCurrencyError);
  });
  it('adds and subtracts same currency, throws on mismatch', () => {
    expect(add(money(100, 'USD'), money(250, 'USD'))).toEqual(money(350, 'USD'));
    expect(subtract(money(100, 'USD'), money(250, 'USD'))).toEqual(money(-150, 'USD'));
    expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow(CurrencyMismatchError);
  });
  it('multiplies by a ratio with rounding', () => {
    expect(multiply(money(1000, 'USD'), 1 / 3)).toEqual(money(333, 'USD'));
    expect(multiply(money(1000, 'USD'), 0.125)).toEqual(money(125, 'USD'));
    expect(multiply(money(1005, 'USD'), 0.5)).toEqual(money(503, 'USD'));
    expect(multiply(money(1005, 'USD'), 0.5, 'HALF_EVEN')).toEqual(money(502, 'USD'));
  });
  it('allocates by weights with largest remainder so the sum is exact', () => {
    const parts = allocate(money(100, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.minor)).toEqual([34, 33, 33]);
    expect(parts.reduce((s, p) => s + p.minor, 0)).toBe(100);
    const uneven = allocate(money(1001, 'USD'), [70, 30]);
    expect(uneven.map((p) => p.minor)).toEqual([701, 300]);
  });
  it('allocate rejects empty or all-zero weights', () => {
    expect(() => allocate(money(100, 'USD'), [])).toThrow();
    expect(() => allocate(money(100, 'USD'), [0, 0])).toThrow();
  });
  it('compares and formats', () => {
    expect(compareMoney(money(1, 'USD'), money(2, 'USD'))).toBe(-1);
    expect(toDecimalString(money(-123456, 'USD'))).toBe('-1234.56');
    expect(toDecimalString(money(5, 'JPY'))).toBe('5');
    expect(formatMoney(money(123456, 'USD'))).toBe('$1,234.56');
  });
  it('is JSON-safe', () => {
    const m = money(1, 'USD');
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
