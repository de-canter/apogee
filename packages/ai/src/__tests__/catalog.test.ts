import { describe, expect, it } from 'vitest';
import { UnknownModelError, createCatalog } from '../catalog';

describe('ModelCatalog', () => {
  const catalog = createCatalog();
  it('knows the current models with prices and limits', () => {
    const opus = catalog.get('claude-opus-5');
    expect(opus.pricePerMTok.input).toBe(5);
    expect(opus.pricePerMTok.output).toBe(25);
    expect(opus.contextWindow).toBe(1_000_000);
    expect(catalog.has('claude-haiku-4-5')).toBe(true);
    expect(() => catalog.get('gpt-4')).toThrow(UnknownModelError);
  });
  it('prices usage including cache reads and writes', () => {
    const cost = catalog.costOf('claude-opus-5', { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 });
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
    expect(catalog.costOf('claude-haiku-4-5', { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.001, 9);
  });
  it('accepts overrides and additions', () => {
    const c = createCatalog([
      { id: 'claude-opus-5', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 } },
      { id: 'custom-model', family: 'custom', contextWindow: 8000, maxOutput: 1000, pricePerMTok: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ]);
    expect(c.get('claude-opus-5').pricePerMTok.input).toBe(1);
    expect(c.has('custom-model')).toBe(true);
    expect(c.list().length).toBeGreaterThan(5);
  });
});
