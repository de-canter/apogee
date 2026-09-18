import { describe, expect, it } from 'vitest';
import {
  QuantitySchema, UnitMismatchError, addQuantity, compareQuantity, formatQuantity,
  quantity, scaleQuantity, subtractQuantity,
} from '../quantity';

describe('Quantity', () => {
  it('uses the unit default precision and rounds value to it', () => {
    expect(quantity(1.23456, 'acre')).toEqual({ value: 1.235, unit: 'acre', precision: 3 });
    expect(quantity(1500.7, 'sqft')).toEqual({ value: 1501, unit: 'sqft', precision: 0 });
  });
  it('accepts explicit precision and rejects unknown units', () => {
    expect(quantity(0.125, 'percent', 3)).toEqual({ value: 0.125, unit: 'percent', precision: 3 });
    expect(() => quantity(1, 'furlong')).toThrow();
    expect(QuantitySchema.safeParse({ value: 1, unit: 'acre', precision: -1 }).success).toBe(false);
  });
  it('adds and subtracts same unit at the coarser precision, throws on mismatch', () => {
    expect(addQuantity(quantity(1.5, 'acre', 1), quantity(0.25, 'acre', 2))).toEqual({ value: 1.8, unit: 'acre', precision: 1 });
    expect(subtractQuantity(quantity(10, 'each'), quantity(3, 'each'))).toEqual({ value: 7, unit: 'each', precision: 0 });
    expect(() => addQuantity(quantity(1, 'acre'), quantity(1, 'sqft'))).toThrow(UnitMismatchError);
  });
  it('scales with rounding', () => {
    expect(scaleQuantity(quantity(10, 'each'), 1 / 3)).toEqual({ value: 3, unit: 'each', precision: 0 });
    expect(scaleQuantity(quantity(1, 'acre'), 0.5)).toEqual({ value: 0.5, unit: 'acre', precision: 3 });
  });
  it('compares and formats', () => {
    expect(compareQuantity(quantity(1, 'acre'), quantity(2, 'acre'))).toBe(-1);
    expect(formatQuantity(quantity(1234.5, 'sqft', 1))).toBe('1,234.5 sq ft');
  });
});
