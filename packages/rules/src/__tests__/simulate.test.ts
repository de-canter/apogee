import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDimensions } from '../dimensions';
import { defineRule } from '../rule';
import { simulate } from '../simulate';

const dims = defineDimensions({ event: z.enum(['created', 'returned']), tier: z.enum(['standard', 'high']) });

const deposit = defineRule(dims, {
  id: 'deposit', name: 'Deposit note', category: 'gate', priority: 200, conditions: { event: ['created'], tier: ['high'] },
  instruction: 'Ask for a deposit and record it with add_note before confirming.', description: 'd',
  structuredChecks: [{ field: 'notes', check: 'not_empty', message: 'A deposit note is required', severity: 'warning' }],
});
const welcome = defineRule(dims, { id: 'welcome', name: 'Welcome back', category: 'desk', conditions: {}, instruction: 'Greet returning customers by name, every time.', description: 'd' });
const returned = defineRule(dims, { id: 'returned', name: 'Return check', category: 'desk', conditions: { event: ['returned'] }, instruction: 'Inspect on return.', description: 'd' });
const off = defineRule(dims, { id: 'off', name: 'Off', category: 'desk', conditions: {}, enabled: false });

const scenarios = [
  { id: 'big', name: 'High-value rental created', facts: { event: 'created' as const, tier: 'high' as const }, subject: { notes: [] } },
  { id: 'back', name: 'Unit returned', facts: { event: 'returned' as const } },
];

describe('simulate', () => {
  it('reports matched rules with condition details, checks, and the compiled section per scenario', () => {
    let t = 0;
    const [big, back] = simulate([deposit, welcome, returned, off], scenarios, { dims, clock: () => (t += 3) });
    expect(big).toMatchObject({ scenarioId: 'big', scenarioName: 'High-value rental created', totalRulesEvaluated: 3, durationMs: 3 });
    expect(big!.matched.map((m) => m.ruleId)).toEqual(['deposit', 'welcome']);
    expect(big!.matched[0]).toMatchObject({ name: 'Deposit note', category: 'gate', priority: 200, matchedConditions: { event: { rule: ['created'], fact: 'created' }, tier: { rule: ['high'], fact: 'high' } } });
    expect(big!.matched[0]!.checks).toMatchObject([{ field: 'notes', passed: false, severity: 'warning' }]);
    expect(big!.matched[1]!.matchedConditions).toEqual({ _unconditional: true });
    expect(big!.matched[1]!.checks).toEqual([]);
    expect(big!.compiled.ruleIds).toEqual(['deposit', 'welcome']);
    expect(big!.diagnostics).toBeUndefined();
    expect(back!.matched.map((m) => m.ruleId)).toEqual(['returned', 'welcome']);
    expect(back!.matched[0]!.checks).toBeUndefined();
  });

  it('filters by ruleIds and category', () => {
    const [big] = simulate([deposit, welcome, returned], scenarios, { dims, ruleIds: ['welcome'] });
    expect(big!.matched.map((m) => m.ruleId)).toEqual(['welcome']);
    const [gateOnly] = simulate([deposit, welcome, returned], scenarios, { dims, category: 'gate' });
    expect(gateOnly!.matched.map((m) => m.ruleId)).toEqual(['deposit']);
    expect(gateOnly!.totalRulesEvaluated).toBe(1);
  });

  it('includes structural and cross-rule diagnostics for the matched rules on request', () => {
    const short = defineRule(dims, { id: 'short', name: 'Short', category: 'desk', conditions: {}, instruction: 'Hi.' });
    const [big] = simulate([welcome, short], scenarios, { dims, validate: true });
    expect(big!.diagnostics?.map((d) => `${d.ruleId}:${d.code}`)).toEqual(expect.arrayContaining(['short:S005', 'short:S008', 'short:C002', 'welcome:C002']));
  });
});
