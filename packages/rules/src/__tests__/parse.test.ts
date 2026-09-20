import { createFakeModelClient, StructuredOutputError, type SystemBlock } from '@de_canter/apogee-ai';
import { AssertionStateError, isoDate, ref } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDimensions } from '../dimensions';
import { RulesError } from '../errors';
import { confidenceLevel, confirmRule, parseRule, rejectRule, ruleIdFor } from '../parse';

const dims = defineDimensions({
  event: z.enum(['rental.created', 'rental.returned']).describe('What just happened'),
  rentalTier: z.enum(['standard', 'high-value']),
});
const now = () => isoDate('2026-09-18T12:00:00Z');
const engine = { dims, domain: 'an equipment rental company', categories: ['workflow', 'gate'], now };

const depositOutput = {
  rule: {
    name: 'Deposit note for high-value rentals',
    description: 'Require a deposit note before confirming a high-value rental.',
    category: 'gate',
    conditions: { event: ['rental.created'], rentalTier: ['high-value'] },
    instruction: 'Ask for a deposit and record it with add_note before confirming.',
    suggestedActions: ['add_deposit_note', 'waive_deposit'],
    defaultAction: 'add_deposit_note',
    structuredChecks: [{ field: 'notes', check: 'not_empty', message: 'A deposit note is required', severity: 'warning' }],
    priority: 200,
  },
  confidence: 0.85,
  ambiguities: [{ field: 'rentalTier', message: 'Assumed $2,000 means the high-value tier', suggestions: ['high-value'] }],
  summary: 'Require a deposit note on high-value rentals.',
};

const systemText = (system: string | SystemBlock[] | undefined): string => (typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n'));

describe('helpers', () => {
  it('maps confidence to a level', () => {
    expect(confidenceLevel(0.95)).toBe('high');
    expect(confidenceLevel(0.9)).toBe('medium');
    expect(confidenceLevel(0.7)).toBe('medium');
    expect(confidenceLevel(0.69)).toBe('low');
  });
  it('slugs a rule id from category and name', () => {
    expect(ruleIdFor('gate', 'Deposit note for high-value rentals!')).toBe('gate-deposit-note-for-high-value-rentals');
  });
});

describe('parseRule', () => {
  it('returns a proposed assertion whose object is the rule', async () => {
    const client = createFakeModelClient([{ object: depositOutput, usage: { input: 10, output: 5 } }]);
    const parsed = await parseRule('When a rental over $2,000 is created, require a deposit note', { ...engine, client }, { categoryHint: 'gate', scope: ref('Company', 'c1') });
    expect(parsed.rule.id).toBe('gate-deposit-note-for-high-value-rentals');
    expect(parsed.rule).toMatchObject({ enabled: true, version: 1, priority: 200, scope: { kind: 'Company', id: 'c1' } });
    expect(parsed.rule.structuredChecks[0]?.severity).toBe('warning');
    expect(parsed.rule.provenance).toEqual({ source: { kind: 'ai', name: 'rules.parse-rule@1.0.0' }, method: 'parseRule', confidence: 0.85, recordedAt: '2026-09-18T12:00:00.000Z' });
    expect(parsed.confidenceLevel).toBe('medium');
    expect(parsed.ambiguities).toHaveLength(1);
    expect(parsed.summary).toBe('Require a deposit note on high-value rentals.');
    expect(parsed.usage.input).toBe(10);
    expect(parsed.assertion).toMatchObject({ status: 'proposed', predicate: 'proposes-rule', subject: { kind: 'RuleSet', id: 'default' }, object: parsed.rule });
    expect(parsed.assertion.provenance.confidence).toBe(0.85);

    const call = client.calls[0]!;
    const system = systemText(call.system);
    expect(system).toContain('an equipment rental company');
    expect(system).toContain('- event (one of: rental.created, rental.returned): What just happened');
    expect(system).toContain('Categories: workflow, gate.');
    const user = call.messages[0]!.content as string;
    expect(user).toContain('"When a rental over $2,000 is created, require a deposit note"');
    expect(user).toContain('Hint: this rule belongs to the "gate" category.');
    expect(call.model).toBe('default');
  });

  it('rejects model output that does not fit the dimensions', async () => {
    const client = createFakeModelClient([{ object: { ...depositOutput, rule: { ...depositOutput.rule, conditions: { bogus: ['x'] } } } }]);
    await expect(parseRule('x', { ...engine, client })).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('rejects an unknown category when the host declares categories', async () => {
    const client = createFakeModelClient([{ object: { ...depositOutput, rule: { ...depositOutput.rule, category: 'other' } } }]);
    await expect(parseRule('x', { ...engine, client })).rejects.toMatchObject({ code: 'BAD_CATEGORY' });
  });

  it('needs a client', async () => {
    await expect(parseRule('x', engine)).rejects.toBeInstanceOf(RulesError);
  });
});

describe('confirmRule / rejectRule', () => {
  const by = ref('User', 'jeff');
  it('confirms the assertion and the rule provenance', async () => {
    const parsed = await parseRule('x', { ...engine, client: createFakeModelClient([{ object: depositOutput }]) });
    const at = isoDate('2026-09-18T13:00:00Z');
    const confirmed = confirmRule(parsed, by, at);
    expect(confirmed.assertion).toMatchObject({ status: 'confirmed', decidedBy: by, decidedAt: at });
    expect(confirmed.rule.provenance).toMatchObject({ confirmedBy: by, confirmedAt: at, confidence: 0.85 });
    expect(confirmed.rule.id).toBe(parsed.rule.id);
    expect(() => confirmRule(confirmed, by)).toThrow(AssertionStateError);
  });
  it('rejects the assertion', async () => {
    const parsed = await parseRule('x', { ...engine, client: createFakeModelClient([{ object: depositOutput }]) });
    expect(rejectRule(parsed, by)).toMatchObject({ status: 'rejected', decidedBy: by });
  });
});
