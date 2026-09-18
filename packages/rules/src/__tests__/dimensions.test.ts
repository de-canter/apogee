import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDimensions } from '../dimensions';
import { RulesError } from '../errors';

const dims = defineDimensions({
  documentType: z.enum(['agreement', 'inspection', 'invoice']).describe('Kind of document'),
  highValue: z.boolean(),
});

describe('defineDimensions', () => {
  it('keeps keys in declaration order', () => {
    expect(dims.keys).toEqual(['documentType', 'highValue']);
  });

  it('accepts conditions as arrays of allowed values', () => {
    expect(dims.conditions.parse({ documentType: ['invoice'] })).toEqual({ documentType: ['invoice'] });
    expect(dims.conditions.parse({ highValue: [true], naturalLanguage: 'after hours' })).toEqual({ highValue: [true], naturalLanguage: 'after hours' });
  });

  it('rejects empty arrays, unknown keys, and values outside the dimension', () => {
    expect(dims.conditions.safeParse({ documentType: [] }).success).toBe(false);
    expect(dims.conditions.safeParse({ bogus: ['x'] }).success).toBe(false);
    expect(dims.conditions.safeParse({ documentType: ['deed'] }).success).toBe(false);
  });

  it('accepts facts as one value per dimension', () => {
    expect(dims.facts.parse({ documentType: 'invoice', highValue: true })).toEqual({ documentType: 'invoice', highValue: true });
    expect(dims.facts.safeParse({ documentType: ['invoice'] }).success).toBe(false);
    expect(dims.facts.safeParse({ other: 1 }).success).toBe(false);
  });

  it('describes each dimension on one line for prompts', () => {
    expect(dims.describe()).toBe('- documentType (one of: agreement, inspection, invoice): Kind of document\n- highValue (boolean)');
  });

  it('allows an empty shape', () => {
    const none = defineDimensions({});
    expect(none.keys).toEqual([]);
    expect(none.conditions.parse({ naturalLanguage: 'x' })).toEqual({ naturalLanguage: 'x' });
    expect(none.describe()).toBe('');
  });

  it('rejects the reserved naturalLanguage key', () => {
    expect(() => defineDimensions({ naturalLanguage: z.string() })).toThrow(RulesError);
  });
});
