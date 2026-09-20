import { createFakeModelClient } from '@de_canter/apogee-ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { detectConflicts, deterministicConflicts, resolutionsFor } from '../conflicts';
import { defineDimensions } from '../dimensions';
import { defineRule } from '../rule';

const dims = defineDimensions({ event: z.enum(['created', 'returned']), tier: z.enum(['standard', 'high']) });
const engine = { dims, domain: 'an equipment rental company' };

const a = defineRule(dims, { id: 'a', name: 'A', category: 'desk', conditions: { event: ['created'] }, priority: 100, instruction: 'Offer delivery.' });
const tie = defineRule(dims, { id: 'tie', name: 'Tie', category: 'desk', conditions: { event: ['created'] }, priority: 100, instruction: 'Offer pickup only.' });
const twin = defineRule(dims, { id: 'twin', name: 'Twin', category: 'desk', conditions: { event: ['created'] }, priority: 200, instruction: 'Mention insurance.' });
const narrow = defineRule(dims, { id: 'narrow', name: 'Narrow', category: 'desk', conditions: { event: ['created'], tier: ['high'] }, priority: 50, instruction: 'Ask for a deposit.' });
const otherCat = defineRule(dims, { id: 'gate', name: 'Gate', category: 'gate', conditions: { event: ['created'] }, priority: 100, instruction: 'Block.' });
const off = defineRule(dims, { id: 'off', name: 'Off', category: 'desk', conditions: { event: ['created'] }, priority: 100, enabled: false });

describe('deterministicConflicts', () => {
  it('finds priority collisions, identical conditions, and subset pairs within a category', () => {
    const cs = deterministicConflicts([a, tie, twin, narrow, otherCat, off]);
    const byPair = Object.fromEntries(cs.map((c) => [c.ruleIds.join('+'), c.type]));
    expect(byPair).toEqual({
      'a+tie': 'priority_collision',
      'a+twin': 'identical_conditions',
      'a+narrow': 'subset_superset',
      'tie+twin': 'identical_conditions',
      'tie+narrow': 'subset_superset',
      'twin+narrow': 'subset_superset',
    });
    expect(cs.map((c) => c.id)).toEqual(cs.map((_, i) => `conflict-${i + 1}`));
    const subset = cs.find((c) => c.ruleIds.join('+') === 'a+narrow')!;
    expect(subset.description).toContain('"narrow" is narrower than "a"');
    expect(subset.severity).toBe('info');
    expect(subset.overlappingConditions).toEqual({ event: ['created'], tier: ['high'] });
    expect(cs.find((c) => c.type === 'priority_collision')?.ruleNames).toEqual(['A', 'Tie']);
  });
});

describe('resolutionsFor', () => {
  it('suggests per type', () => {
    expect(resolutionsFor({ type: 'priority_collision', ruleIds: ['a', 'tie'] }).map((r) => r.action)).toEqual(['adjust_priority']);
    expect(resolutionsFor({ type: 'priority_collision', ruleIds: ['a', 'tie'] })[0]?.suggestedValues).toEqual({ a: 110, tie: 100 });
    expect(resolutionsFor({ type: 'identical_conditions', ruleIds: ['a', 'b'] }).map((r) => r.action)).toEqual(['adjust_priority', 'merge_rules', 'disable_rule']);
    expect(resolutionsFor({ type: 'subset_superset', ruleIds: ['a', 'b'] }).map((r) => r.action)).toEqual(['adjust_priority', 'differentiate_conditions']);
    expect(resolutionsFor({ type: 'conflicting_instructions', ruleIds: ['a', 'b'] }).map((r) => r.action)).toEqual(['merge_rules', 'disable_rule', 'differentiate_conditions']);
    expect(resolutionsFor({ type: 'redundant_rule', ruleIds: ['a', 'b'] }).map((r) => r.action)).toEqual(['disable_rule', 'merge_rules']);
    expect(resolutionsFor({ type: 'redundant_rule', ruleIds: ['a', 'b'] })[0]?.targetRuleIds).toEqual(['b']);
  });
});

describe('detectConflicts', () => {
  it('reports deterministic conflicts with counts and a summary', async () => {
    const r = await detectConflicts([a, tie, twin, narrow, otherCat], engine, { clock: (() => { let t = 0; return () => (t += 5); })() });
    expect(r.totalConflicts).toBe(6);
    expect(r.byType).toEqual({ identical_conditions: 2, subset_superset: 3, conflicting_instructions: 0, priority_collision: 1, redundant_rule: 0 });
    expect(r.rulesAnalyzed).toBe(5);
    expect(r.aiAnalysisPerformed).toBe(false);
    expect(r.summary).toBe('6 conflicts among 5 rules: 2 identical_conditions, 1 priority_collision, 3 subset_superset');
    expect(r.durationMs).toBe(5);
    expect(r.generatedAt).toMatch(/^\d{4}-/);
  });
  it('filters by ruleIds, category, and includes disabled on request', async () => {
    expect((await detectConflicts([a, tie, twin], engine, { ruleIds: ['a', 'tie'] })).totalConflicts).toBe(1);
    expect((await detectConflicts([a, otherCat], engine, { category: 'gate' })).rulesAnalyzed).toBe(1);
    expect((await detectConflicts([a, off], engine)).totalConflicts).toBe(0);
    expect((await detectConflicts([a, off], engine, { includeDisabled: true })).totalConflicts).toBe(1);
    expect((await detectConflicts([], engine)).summary).toBe('No conflicts among 0 rules.');
  });
  it('adds AI conflicts per category and drops unknown ids', async () => {
    const client = createFakeModelClient([{
      object: { conflicts: [
        { type: 'conflicting_instructions', ruleIds: ['a', 'tie'], description: 'Delivery vs pickup only', explanation: 'They contradict.' },
        { type: 'redundant_rule', ruleIds: ['a', 'ghost'], description: 'x', explanation: 'y' },
      ] },
      usage: { input: 4 },
    }]);
    const r = await detectConflicts([a, tie, otherCat], { ...engine, client }, { ai: true });
    expect(r.aiAnalysisPerformed).toBe(true);
    expect(r.usage?.input).toBe(4);
    const ai = r.conflicts.find((c) => c.type === 'conflicting_instructions')!;
    expect(ai).toMatchObject({ id: 'conflict-2', severity: 'warning', ruleIds: ['a', 'tie'], aiExplanation: 'They contradict.', category: 'desk' });
    expect(ai.resolutions.map((x) => x.action)).toEqual(['merge_rules', 'disable_rule', 'differentiate_conditions']);
    expect(r.conflicts.some((c) => c.type === 'redundant_rule')).toBe(false);
    expect(client.calls).toHaveLength(1);
    const user = client.calls[0]!.messages[0]!.content as string;
    expect(user).toContain('"desk" category');
    expect(user).toContain('Rule A: {"id":"a"');
    expect(user).toContain('Rule B: {"id":"tie"');
  });
  it('skips the model when no category has an overlapping pair', async () => {
    const client = createFakeModelClient([]);
    const far = defineRule(dims, { id: 'far', name: 'Far', category: 'desk', conditions: { event: ['returned'] } });
    const r = await detectConflicts([a, far], { ...engine, client }, { ai: true });
    expect(r.aiAnalysisPerformed).toBe(true);
    expect(client.calls).toHaveLength(0);
  });
  it('needs a client for AI analysis', async () => {
    await expect(detectConflicts([a, tie], engine, { ai: true })).rejects.toMatchObject({ code: 'NO_CLIENT' });
  });
});
