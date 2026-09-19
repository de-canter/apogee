import { describe, expect, it } from 'vitest';
import { combineConfidence, confidence, confidenceLevel } from '../confidence';

describe('confidenceLevel', () => {
  it('bands at 0.9 and 0.7 by default', () => {
    expect(confidenceLevel(0.95)).toBe('high');
    expect(confidenceLevel(0.9)).toBe('high');
    expect(confidenceLevel(0.7)).toBe('medium');
    expect(confidenceLevel(0.69)).toBe('low');
  });
  it('honors custom bands', () => {
    expect(confidenceLevel(0.8, { high: 0.8, medium: 0.5 })).toBe('high');
  });
});

describe('confidence', () => {
  it('clamps and carries factors', () => {
    expect(confidence(1.4, ['clear scan'])).toEqual({ value: 1, level: 'high', factors: ['clear scan'] });
    expect(confidence(-0.2)).toEqual({ value: 0, level: 'low', factors: [] });
  });
});

describe('combineConfidence', () => {
  it('takes the weakest link and concatenates factors', () => {
    const c = combineConfidence([confidence(0.95, ['a']), confidence(0.72, ['b', 'c'])]);
    expect(c).toEqual({ value: 0.72, level: 'medium', factors: ['a', 'b', 'c'] });
  });
  it('defaults to 0.5 with no parts', () => {
    expect(combineConfidence([])).toEqual({ value: 0.5, level: 'low', factors: ['no signals'] });
  });
});
