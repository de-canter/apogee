/**
 * Spec §7 criterion: round-trip a natural-language rule to a confirmed Rule and evaluate
 * it in both layers, with the condition dimensions supplied by the host.
 */
import { createAgentSession, createToolRegistry, type AgentEvent } from '@de_canter/apogee-agent';
import { createFakeModelClient, type FakeTurn, type GenerateRequest } from '@de_canter/apogee-ai';
import { isoDate, ref } from '@de_canter/apogee-kernel';
import { composePrompt, definePrompt, slot, text } from '@de_canter/apogee-prompts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInMemoryRuleAudit } from '../audit';
import { rulesContributor } from '../compile';
import { defineDimensions, type Facts } from '../dimensions';
import { evaluateGate } from '../evaluate';
import { createInMemoryRuleStore, createRuleLoader } from '../store';
import { ruleTools } from '../tools';

const dims = defineDimensions({
  event: z.enum(['rental.created', 'rental.returned']).describe('What just happened'),
  rentalTier: z.enum(['standard', 'high-value']).describe('high-value when the total is $2,000 or more'),
});
type D = typeof dims.shape;
interface AdminCtx { sessionId: string; manager: string }
interface DeskCtx { event?: 'rental.created' | 'rental.returned'; total?: number }
const now = () => isoDate('2026-09-18T12:00:00Z');

const RULE_TEXT = 'When a rental over $2,000 is created, require a deposit note before confirming';

const parseOutput = {
  rule: {
    name: 'Deposit note for high-value rentals', description: 'Require a deposit note before confirming a high-value rental.', category: 'gate',
    conditions: { event: ['rental.created'], rentalTier: ['high-value'] },
    instruction: 'Before confirming, ask the customer for a deposit and record it with add_note.',
    suggestedActions: ['add_deposit_note', 'waive_deposit'], defaultAction: 'add_deposit_note',
    structuredChecks: [{ field: 'notes', check: 'not_empty', message: 'A deposit note is required for high-value rentals', severity: 'warning' }], priority: 200,
  },
  confidence: 0.85, ambiguities: [{ field: 'rentalTier', message: 'Assumed $2,000 means the high-value tier', suggestions: ['high-value'] }], summary: 'Require a deposit note on high-value rentals.',
};

/** One fake client serves the agent loop, the parser, and the gate evaluator; it routes on the request shape. */
const script = (req: GenerateRequest, index: number): FakeTurn => {
  const user = req.messages[0]!.content;
  if (typeof user === 'string' && user.startsWith('Parse this rule')) return { object: parseOutput };
  if (typeof user === 'string' && user.startsWith('Rules:')) return { object: { passed: true, findings: ['Deposit of $400 is recorded in the notes.'] } };
  if (req.tools && req.tools.length > 0) {
    return index === 0
      ? { text: 'Let me draft that rule.', toolUses: [{ id: 'tu-propose', name: 'propose_rule', input: { text: RULE_TEXT, categoryHint: 'gate' } }] }
      : { text: 'I have drafted the rule; confirm it on the card to make it active.' };
  }
  return { text: 'unexpected' };
};

describe('acceptance: admin proposes, manager confirms, desk obeys, gate evaluates', () => {
  it('round-trips a natural-language rule through both layers', async () => {
    const client = createFakeModelClient(script);
    const store = createInMemoryRuleStore<D>();
    const audit = createInMemoryRuleAudit({ now });
    const loader = createRuleLoader({ store, ttlMs: 60_000 });
    const engine = { dims, client, domain: 'an equipment rental company', categories: ['desk', 'gate'], model: 'fast' as const, now };
    const set = ruleTools<AdminCtx, D>({ engine, store, audit, actorFromCtx: (c) => ref('User', c.manager), sessionIdFromCtx: (c) => c.sessionId, onChange: () => loader.invalidate() });

    // 1. The admin assistant proposes the rule through a tool round.
    const adminPrompt = definePrompt<AdminCtx>({ name: 'test.admin', version: '1.0.0', sections: [text('id', 'You administer rules.')] });
    const session = createAgentSession<AdminCtx>({ sessionId: 'admin-1', client, prompt: adminPrompt, tools: set.tools, ctx: { sessionId: 'admin-1', manager: 'jeff' }, model: 'fast' });
    const events: AgentEvent[] = [];
    for await (const e of session.run(RULE_TEXT)) events.push(e);
    const artifact = events.find((e) => e.type === 'artifact');
    expect(artifact?.type === 'artifact' && artifact.artifact.type).toBe('rule-proposal');
    const turnEnd = events.find((e) => e.type === 'turn_end');
    expect(turnEnd?.type === 'turn_end' && turnEnd.rounds).toBe(2);
    expect(set.proposals.size).toBe(1);
    const assertionId = [...set.proposals.keys()][0]!;
    expect(set.proposals.get(assertionId)!.assertion.status).toBe('proposed');
    expect(await store.list()).toEqual([]);

    // 2. The manager confirms on the card (the host turns the card action into this tool call).
    const confirm = createToolRegistry(set.tools).get('confirm_rule')!;
    const result = await confirm.execute({ assertionId } as never, { ctx: { sessionId: 'admin-1', manager: 'jeff' }, toolUseId: 'tu-confirm', sessionId: 'admin-1' });
    expect(result.success).toBe(true);
    const rules = await loader.rules();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.provenance).toMatchObject({ source: { kind: 'ai' }, confidence: 0.85, confirmedBy: { kind: 'User', id: 'jeff' } });

    // 3. The desk prompt now carries the rule.
    const deskPrompt = definePrompt<DeskCtx>({ name: 'test.desk', version: '1.0.0', sections: [text('id', 'You run the rental desk.'), slot('rules', 'rules')] });
    const factsFromCtx = (c: DeskCtx): Facts<D> => ({ ...(c.event ? { event: c.event } : {}), ...(c.total !== undefined ? { rentalTier: c.total >= 2000 ? 'high-value' : 'standard' } : {}) });
    const contributor = rulesContributor<DeskCtx, D>({ rules: () => loader.rules(), factsFromCtx, heading: '## Desk rules' });
    const composed = await composePrompt(deskPrompt, {}, { contributors: { rules: contributor } });
    expect(composed.text).toContain('### Deposit note for high-value rentals');
    expect(composed.text).toContain('Applies when: event is rental.created; rentalTier is high-value');

    // 4. Layer 1: the structured check decides when the note is missing.
    const facts = factsFromCtx({ event: 'rental.created', total: 2100 });
    const missing = await evaluateGate(rules, { dims }, { facts, subject: { notes: [] } });
    expect(missing.results[0]).toMatchObject({ matched: true, decidedBy: 'checks', passed: true });
    expect(missing.warnings.map((w) => w.message)).toEqual(['A deposit note is required for high-value rentals']);

    // 5. Layer 2: with the note present and a client, the instruction decides.
    const present = await evaluateGate(rules, engine, { facts, subject: { notes: ['Deposit $400 collected'] } });
    expect(present.results[0]).toMatchObject({ decidedBy: 'instruction', passed: true, findings: ['Deposit of $400 is recorded in the notes.'] });
    expect(present.passed).toBe(true);

    // A standard rental never matches.
    const small = await evaluateGate(rules, engine, { facts: factsFromCtx({ event: 'rental.created', total: 900 }), subject: { notes: [] } });
    expect(small.matched).toBe(0);

    // 6. The audit trail records the confirmation.
    expect((await audit.query({ trigger: 'rule.confirmed' })).total).toBe(1);
  });
});
