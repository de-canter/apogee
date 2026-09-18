import { isoDate } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDimensions, type Conditions } from '../dimensions';
import {
  conditionsIdentical, conditionsNarrower, conditionsOverlap, defineRule, findMatchingRules, matchedConditions, matchesConditions,
  normalizeConditions, ruleSchema,
} from '../rule';

const dims = defineDimensions({
  event: z.enum(['created', 'returned']),
  tier: z.enum(['standard', 'high']),
});
type D = typeof dims.shape;
const now = () => isoDate('2026-09-18T12:00:00Z');

describe('defineRule', () => {
  it('fills defaults and system provenance', () => {
    const r = defineRule(dims, { id: 'r1', name: 'One', category: 'desk', conditions: {} }, now);
    expect(r).toMatchObject({ description: '', instruction: '', suggestedActions: [], structuredChecks: [], priority: 100, enabled: true, version: 1 });
    expect(r.provenance).toEqual({ source: { kind: 'system' }, recordedAt: '2026-09-18T12:00:00.000Z' });
  });

  it('applies check defaults', () => {
    const r = defineRule(dims, { id: 'r1', name: 'One', category: 'desk', conditions: {}, structuredChecks: [{ field: 'notes', check: 'not_empty', message: 'Need a note' }] });
    expect(r.structuredChecks[0]?.severity).toBe('error');
  });
});

describe('ruleSchema', () => {
  const schema = ruleSchema(dims);
  const base = defineRule(dims, { id: 'r1', name: 'One', category: 'desk', conditions: { event: ['created'] } });
  it('bounds priority and name', () => {
    expect(schema.safeParse({ ...base, priority: 1001 }).success).toBe(false);
    expect(schema.safeParse({ ...base, name: 'x'.repeat(101) }).success).toBe(false);
    expect(schema.safeParse({ ...base, version: 0 }).success).toBe(false);
    expect(schema.safeParse(base).success).toBe(true);
  });
  it('validates conditions against the dimensions', () => {
    expect(schema.safeParse({ ...base, conditions: { event: ['deleted'] } }).success).toBe(false);
  });
});

describe('matchesConditions', () => {
  it('requires each conditioned fact to be one of the allowed values', () => {
    expect(matchesConditions<D>({ event: ['created'] }, { event: 'created' })).toBe(true);
    expect(matchesConditions<D>({ event: ['created'] }, { event: 'returned' })).toBe(false);
    expect(matchesConditions<D>({ event: ['created', 'returned'], tier: ['high'] }, { event: 'returned', tier: 'high' })).toBe(true);
  });
  it('fails on a missing fact unless unknownFacts is pass', () => {
    expect(matchesConditions<D>({ tier: ['high'] }, { event: 'created' })).toBe(false);
    expect(matchesConditions<D>({ tier: ['high'] }, { event: 'created' }, { unknownFacts: 'pass' })).toBe(true);
    expect(matchesConditions<D>({ tier: ['high'], event: ['returned'] }, { event: 'created' }, { unknownFacts: 'pass' })).toBe(false);
  });
  it('ignores empty arrays and naturalLanguage', () => {
    const c = { event: [] as never[], naturalLanguage: 'after hours' } as Conditions<D>;
    expect(matchesConditions<D>(c, {})).toBe(true);
  });
  it('matches everything when unconditional', () => {
    expect(matchesConditions<D>({}, {})).toBe(true);
  });
});

describe('findMatchingRules', () => {
  const rules = [
    defineRule(dims, { id: 'b', name: 'B', category: 'desk', conditions: { event: ['created'] }, priority: 100 }),
    defineRule(dims, { id: 'a', name: 'A', category: 'desk', conditions: {}, priority: 100 }),
    defineRule(dims, { id: 'c', name: 'C', category: 'gate', conditions: { event: ['created'] }, priority: 300 }),
    defineRule(dims, { id: 'd', name: 'D', category: 'desk', conditions: {}, priority: 900, enabled: false }),
    defineRule(dims, { id: 'e', name: 'E', category: 'desk', conditions: { event: ['returned'] }, priority: 500 }),
  ];
  it('drops disabled and non-matching rules and sorts by priority then id', () => {
    expect(findMatchingRules(rules, { event: 'created' }).map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
  it('filters by category and can include disabled rules', () => {
    expect(findMatchingRules(rules, { event: 'created' }, { category: 'desk' }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(findMatchingRules(rules, { event: 'created' }, { includeDisabled: true }).map((r) => r.id)).toEqual(['d', 'c', 'a', 'b']);
  });
});

describe('matchedConditions', () => {
  it('reports each conditioned key with the rule values and the fact', () => {
    const r = defineRule(dims, { id: 'r', name: 'R', category: 'desk', conditions: { event: ['created'], tier: ['high'] } });
    expect(matchedConditions(r, { event: 'created' })).toEqual({ event: { rule: ['created'], fact: 'created' }, tier: { rule: ['high'], fact: undefined } });
    const u = defineRule(dims, { id: 'u', name: 'U', category: 'desk', conditions: {} });
    expect(matchedConditions(u, {})).toEqual({ _unconditional: true });
  });
});

describe('condition algebra', () => {
  it('normalizes by dropping empties and sorting values', () => {
    expect(normalizeConditions<D>({ event: ['returned', 'created'], tier: [] as never[], naturalLanguage: 'x' })).toEqual({ event: ['created', 'returned'] });
  });
  it('identical ignores value order', () => {
    expect(conditionsIdentical<D>({ event: ['returned', 'created'] }, { event: ['created', 'returned'] })).toBe(true);
    expect(conditionsIdentical<D>({ event: ['created'] }, { event: ['created'], tier: ['high'] })).toBe(false);
  });
  it('narrower: a matches a subset of what b matches', () => {
    expect(conditionsNarrower<D>({ event: ['created'] }, {})).toBe(true);
    expect(conditionsNarrower<D>({}, { event: ['created'] })).toBe(false);
    expect(conditionsNarrower<D>({ event: ['created'], tier: ['high'] }, { event: ['created', 'returned'] })).toBe(true);
    expect(conditionsNarrower<D>({ event: ['created', 'returned'] }, { event: ['created'] })).toBe(false);
  });
  it('overlap: every shared key intersects', () => {
    expect(conditionsOverlap<D>({ event: ['created'] }, { event: ['returned'] })).toBe(false);
    expect(conditionsOverlap<D>({ event: ['created'] }, { tier: ['high'] })).toBe(true);
    expect(conditionsOverlap<D>({ event: ['created', 'returned'] }, { event: ['returned'], tier: ['standard'] })).toBe(true);
    expect(conditionsOverlap<D>({}, { event: ['created'] })).toBe(true);
  });
});
