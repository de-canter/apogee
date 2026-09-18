import { describe, expect, it } from 'vitest';
import { ClassificationsSchema, TagsSchema, classificationIn, classify, normalizeTag } from '../classification';

describe('Classification', () => {
  it('builds taxonomy/code with optional path', () => {
    const c = classify('property-type', 'sfr', { label: 'Single Family', path: ['residential', 'sfr'] });
    expect(c).toEqual({ taxonomy: 'property-type', code: 'sfr', label: 'Single Family', path: ['residential', 'sfr'] });
  });
  it('allows one classification per taxonomy', () => {
    expect(ClassificationsSchema.safeParse([classify('a', 'x'), classify('a', 'y')]).success).toBe(false);
    expect(ClassificationsSchema.safeParse([classify('a', 'x'), classify('b', 'y')]).success).toBe(true);
  });
  it('finds by taxonomy', () => {
    expect(classificationIn([classify('a', 'x')], 'a')?.code).toBe('x');
    expect(classificationIn([classify('a', 'x')], 'b')).toBeUndefined();
  });
});

describe('Tags', () => {
  it('normalizes to lowercase kebab and rejects duplicates', () => {
    expect(normalizeTag('  Rush Order ')).toBe('rush-order');
    expect(TagsSchema.safeParse(['rush', 'rush']).success).toBe(false);
    expect(TagsSchema.safeParse(['Rush']).success).toBe(false);
  });
});
