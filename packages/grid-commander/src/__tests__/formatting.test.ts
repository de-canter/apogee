import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../utils/formatting';

describe('formatCurrency', () => {
  it('formats number with commas and cents', () => {
    expect(formatCurrency(250000)).toBe('$250,000.00');
  });

  it('formats string numbers', () => {
    expect(formatCurrency('1500.5')).toBe('$1,500.50');
  });

  it('returns em dash for null', () => {
    expect(formatCurrency(null)).toBe('\u2014');
  });

  it('returns em dash for undefined', () => {
    expect(formatCurrency(undefined)).toBe('\u2014');
  });

  it('returns em dash for NaN string', () => {
    expect(formatCurrency('not-a-number')).toBe('\u2014');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});
