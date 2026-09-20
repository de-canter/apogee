import { createFakeModelClient } from '@de_canter/apogee-ai';
import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RuleAuditEntry } from '../audit';
import { defineDimensions } from '../dimensions';
import { defineRule } from '../rule';
import { aggregateAudit, lowEngagementRules, suggestRules } from '../suggest';

const dims = defineDimensions({ event: z.enum(['created', 'returned']) });
const now = () => isoDate('2026-09-18T12:00:00Z');
const engine = { dims, domain: 'an equipment rental company', categories: ['desk', 'gate'], now };

const welcome = defineRule(dims, { id: 'welcome', name: 'Welcome back', category: 'desk', conditions: {}, suggestedActions: ['apply_loyalty_rate'] });
const aerial = defineRule(dims, { id: 'aerial', name: 'Aerial safety', category: 'desk', conditions: { event: ['created'] }, suggestedActions: ['send_safety_sheet'] });

let n = 0;
const entry = (over: Partial<RuleAuditEntry>): RuleAuditEntry => ({
  id: `e${n++}`, at: isoDate('2026-09-10T12:00:00Z'), ruleId: 'welcome', ruleName: 'Welcome back', category: 'desk', trigger: 'session.start',
  conditionsMatched: {}, action: 'greet', suggestedActions: ['apply_loyalty_rate'], success: true, ...over,
});

const entries: RuleAuditEntry[] = [
  entry({ userChoice: 'apply_loyalty_rate' }),
  entry({ userChoice: 'offer_delivery' }),
  entry({ userChoice: 'offer_delivery' }),
  entry({ ruleId: 'aerial', ruleName: 'Aerial safety', trigger: 'rental.created', conditionsMatched: { event: 'created' }, action: 'send_safety_sheet', suggestedActions: ['send_safety_sheet'], userChoice: 'send_safety_sheet' }),
  entry({ trigger: 'manual', conditionsMatched: { event: 'returned' }, action: 'inspect_unit', suggestedActions: [] }),
  entry({ at: isoDate('2026-07-01T12:00:00Z'), userChoice: 'ancient' }),
];

describe('aggregateAudit', () => {
  it('counts within the window, tracks acceptance, and groups off-script actions', () => {
    const agg = aggregateAudit(entries, 30, now);
    expect(agg.totalAudits).toBe(5);
    expect(agg.byRuleId['welcome']).toEqual({ count: 4, accepted: 1, userChoices: ['apply_loyalty_rate', 'offer_delivery', 'offer_delivery'] });
    expect(agg.byRuleId['aerial']).toEqual({ count: 1, accepted: 1, userChoices: ['send_safety_sheet'] });
    expect(agg.byTrigger).toEqual({ 'session.start': 3, 'rental.created': 1, manual: 1 });
    expect(agg.offScript).toEqual([
      { trigger: 'session.start', conditionsMatched: {}, exampleActions: ['greet'], userChoices: ['offer_delivery'], count: 2 },
      { trigger: 'manual', conditionsMatched: { event: 'returned' }, exampleActions: ['inspect_unit'], userChoices: [], count: 1 },
    ]);
  });
});

describe('lowEngagementRules', () => {
  it('flags rules with enough audits and low acceptance', () => {
    const agg = aggregateAudit(entries, 30, now);
    const low = lowEngagementRules(agg, [welcome, aerial]);
    expect(low).toEqual([{ rule: welcome, acceptanceRate: 0.25, total: 4, commonChoices: ['offer_delivery', 'apply_loyalty_rate'] }]);
    expect(lowEngagementRules(agg, [welcome], 5)).toEqual([]);
  });
});

describe('suggestRules', () => {
  const suggestion = (over: Record<string, unknown>) => ({
    source: 'uncovered_actions', confidence: 0.8, reasoning: 'Users keep offering delivery.',
    rule: { name: 'Offer delivery', description: 'Offer delivery on every new rental.', category: 'desk', conditions: { event: ['created'] }, instruction: 'Offer delivery within 40 miles.', suggestedActions: ['offer_delivery'], structuredChecks: [], priority: 100 },
    evidence: { auditCount: 2, exampleActions: ['greet'] },
    ...over,
  });

  it('short-circuits without a model when nothing is off-script and nothing is low-engagement', async () => {
    const client = createFakeModelClient([]);
    const r = await suggestRules([entries[3]!], [aerial], { ...engine, client });
    expect(r.suggestions).toEqual([]);
    expect(r.auditSummary).toEqual({ totalAudits: 1, periodDays: 30, uniqueRules: 1, uniqueTriggers: 1 });
    expect(client.calls).toHaveLength(0);
  });

  it('turns model suggestions into proposed assertions, filtered by confidence and capped', async () => {
    const client = createFakeModelClient([{
      object: { suggestions: [
        suggestion({}),
        suggestion({ source: 'low_engagement', confidence: 0.6, existingRuleId: 'welcome', rule: { name: 'Welcome back v2', description: 'd', category: 'desk', conditions: {}, instruction: 'Greet and offer delivery.', suggestedActions: ['offer_delivery'], structuredChecks: [], priority: 100 } }),
        suggestion({ confidence: 0.4 }),
      ] },
      usage: { input: 9 },
    }]);
    const r = await suggestRules(entries, [welcome, aerial], { ...engine, client }, { minConfidence: 0.5, periodDays: 30 });
    expect(r.suggestions).toHaveLength(2);
    expect(r.suggestions.map((s) => s.rule.id)).toEqual(['suggested-desk-offer-delivery', 'suggested-desk-welcome-back-v2']);
    expect(r.suggestions[0]).toMatchObject({ id: 'suggestion-1', source: 'uncovered_actions', confidence: 0.8, evidence: { auditCount: 2, periodDays: 30, exampleActions: ['greet'] } });
    expect(r.suggestions[0]!.assertion).toMatchObject({ status: 'proposed', predicate: 'suggests-rule' });
    expect(r.suggestions[0]!.rule.provenance).toMatchObject({ source: { kind: 'ai', name: 'rules.suggest-rules@1.0.0' }, confidence: 0.8 });
    expect(r.suggestions[1]).toMatchObject({ existingRuleId: 'welcome', evidence: { acceptanceRate: 0.25 } });
    expect(r.bySource).toEqual({ uncovered_actions: 1, low_engagement: 1, pattern_detection: 0, rule_improvement: 0 });
    expect(r.usage?.input).toBe(9);
    const user = client.calls[0]!.messages[0]!.content as string;
    expect(user).toContain('## Off-script actions');
    expect(user).toContain('## Low-engagement rules');
    expect(user).toContain('## Existing rules (2)');
  });

  it('caps at maxSuggestions', async () => {
    const client = createFakeModelClient([{ object: { suggestions: [suggestion({}), suggestion({ rule: { name: 'Two', description: '', category: 'desk', conditions: {}, instruction: 'i', suggestedActions: [], structuredChecks: [], priority: 100 } })] } }]);
    const r = await suggestRules(entries, [welcome], { ...engine, client }, { maxSuggestions: 1 });
    expect(r.suggestions).toHaveLength(1);
  });

  it('needs a client', async () => {
    await expect(suggestRules(entries, [welcome], engine)).rejects.toMatchObject({ code: 'NO_CLIENT' });
  });
});
