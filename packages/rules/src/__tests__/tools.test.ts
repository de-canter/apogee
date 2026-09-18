import { createToolRegistry, type ToolResult } from '@apogee/agent';
import { createFakeModelClient, type FakeTurn, type GenerateRequest } from '@apogee/ai';
import { isoDate, ref } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInMemoryRuleAudit } from '../audit';
import { defineDimensions } from '../dimensions';
import { defineRule } from '../rule';
import { createInMemoryRuleStore } from '../store';
import { ruleTools } from '../tools';

const dims = defineDimensions({ event: z.enum(['rental.created', 'rental.returned']), rentalTier: z.enum(['standard', 'high-value']) });
type D = typeof dims.shape;
interface Ctx { sessionId: string; manager: string }
const now = () => isoDate('2026-09-18T12:00:00Z');

const depositOutput = {
  rule: {
    name: 'Deposit note for high-value rentals', description: 'Require a deposit note before confirming.', category: 'gate',
    conditions: { event: ['rental.created'], rentalTier: ['high-value'] },
    instruction: 'Ask for a deposit and record it with add_note before confirming the rental.',
    suggestedActions: ['add_deposit_note', 'waive_deposit'], defaultAction: 'add_deposit_note',
    structuredChecks: [{ field: 'notes', check: 'not_empty', message: 'A deposit note is required', severity: 'warning' }], priority: 200,
  },
  confidence: 0.85, ambiguities: [{ field: 'rentalTier', message: 'Assumed $2,000 is high-value', suggestions: ['high-value'] }], summary: 'Require a deposit note on high-value rentals.',
};

const script = (req: GenerateRequest): FakeTurn => {
  const user = req.messages[0]!.content;
  if (typeof user === 'string' && user.startsWith('Parse this rule')) return { object: depositOutput };
  if (typeof user === 'string' && user.startsWith('Overlapping rule pairs')) return { object: { conflicts: [] } };
  return { text: 'unexpected' };
};

function setup() {
  const store = createInMemoryRuleStore<D>([
    defineRule(dims, { id: 'desk-welcome-back', name: 'Welcome back', category: 'desk', conditions: {}, instruction: 'Greet returning customers by name and mention the loyalty rate.', description: 'd' }, now),
  ]);
  const audit = createInMemoryRuleAudit({ now });
  const client = createFakeModelClient(script);
  const changes: number[] = [];
  const set = ruleTools<Ctx, D>({
    engine: { dims, client, domain: 'an equipment rental company', categories: ['desk', 'gate'], now },
    store, audit,
    actorFromCtx: (c) => ref('User', c.manager),
    sessionIdFromCtx: (c) => c.sessionId,
    onChange: () => changes.push(1),
  });
  const registry = createToolRegistry(set.tools);
  const context = { ctx: { sessionId: 's1', manager: 'jeff' }, toolUseId: 'tu1', sessionId: 's1' };
  const call = (name: string, input: unknown): Promise<ToolResult> => registry.get(name)!.execute(input as never, context);
  return { store, audit, client, changes, set, registry, call };
}

describe('ruleTools', () => {
  it('exposes the admin tool set with JSON-schema definitions', () => {
    const { registry } = setup();
    expect(registry.definitions().map((d) => d.name).sort()).toEqual(['check_conflicts', 'confirm_rule', 'delete_rule', 'list_rules', 'propose_rule', 'reject_rule', 'set_rule_enabled', 'simulate_rules']);
  });

  it('lists rules as cards', async () => {
    const { call } = setup();
    const r = await call('list_rules', {});
    expect(r.success).toBe(true);
    expect(r.artifacts).toMatchObject([{ type: 'rule-card', id: 'rule-desk-welcome-back-tu1', data: { ruleId: 'desk-welcome-back', enabled: true } }]);
  });

  it('proposes a rule as a pending assertion with a proposal card', async () => {
    const { call, set } = setup();
    const r = await call('propose_rule', { text: 'When a rental over $2,000 is created, require a deposit note', categoryHint: 'gate' });
    expect(r.success).toBe(true);
    const data = r.data as { assertionId: string; confidenceLevel: string; diagnostics: unknown[] };
    expect(data.confidenceLevel).toBe('medium');
    expect(set.proposals.get(data.assertionId)?.rule.id).toBe('gate-deposit-note-for-high-value-rentals');
    expect(r.artifact).toMatchObject({ type: 'rule-proposal', id: `proposal-${data.assertionId}`, data: { assertionId: data.assertionId, confidence: 0.85 } });
    expect(r.message).toContain('confirm_rule');
  });

  it('confirms a proposal with edits, stores it, audits it, and notifies', async () => {
    const { call, set, store, audit, changes } = setup();
    const proposed = await call('propose_rule', { text: 'x' });
    const { assertionId } = proposed.data as { assertionId: string };
    const r = await call('confirm_rule', { assertionId, edits: { priority: 250 } });
    expect(r.success).toBe(true);
    expect(r.artifact).toMatchObject({ type: 'rule-card', data: { ruleId: 'gate-deposit-note-for-high-value-rentals', priority: 250 } });
    const stored = await store.get('gate-deposit-note-for-high-value-rentals');
    expect(stored?.priority).toBe(250);
    expect(stored?.provenance).toMatchObject({ source: { kind: 'ai' }, confidence: 0.85, confirmedBy: { kind: 'User', id: 'jeff' } });
    expect(set.proposals.has(assertionId)).toBe(false);
    expect(changes).toHaveLength(1);
    expect((await audit.query({ trigger: 'rule.confirmed' })).entries[0]).toMatchObject({ ruleId: 'gate-deposit-note-for-high-value-rentals', sessionId: 's1', actor: { kind: 'User', id: 'jeff' }, action: 'confirm_rule' });
  });

  it('fails softly on an unknown proposal or invalid edits', async () => {
    const { call } = setup();
    expect(await call('confirm_rule', { assertionId: 'nope' })).toMatchObject({ success: false, error: 'No pending proposal nope' });
    const proposed = await call('propose_rule', { text: 'x' });
    const { assertionId } = proposed.data as { assertionId: string };
    const r = await call('confirm_rule', { assertionId, edits: { priority: 5000 } });
    expect(r.success).toBe(false);
    expect(r.error).toContain('priority');
  });

  it('rejects a proposal and audits it', async () => {
    const { call, set, audit } = setup();
    const { assertionId } = (await call('propose_rule', { text: 'x' })).data as { assertionId: string };
    const r = await call('reject_rule', { assertionId, reason: 'Too strict' });
    expect(r.success).toBe(true);
    expect(set.proposals.has(assertionId)).toBe(false);
    expect((await audit.query({ trigger: 'rule.rejected' })).entries[0]).toMatchObject({ metadata: { reason: 'Too strict' } });
  });

  it('toggles and deletes rules with version bumps and audit', async () => {
    const { call, store, audit, changes } = setup();
    expect(await call('set_rule_enabled', { ruleId: 'desk-welcome-back', enabled: false })).toMatchObject({ success: true });
    expect(await store.get('desk-welcome-back')).toMatchObject({ enabled: false, version: 2 });
    expect(await call('set_rule_enabled', { ruleId: 'missing', enabled: false })).toMatchObject({ success: false });
    expect(await call('delete_rule', { ruleId: 'desk-welcome-back' })).toMatchObject({ success: true });
    expect(await store.get('desk-welcome-back')).toBeUndefined();
    expect(await call('delete_rule', { ruleId: 'desk-welcome-back' })).toMatchObject({ success: false });
    expect(changes).toHaveLength(2);
    expect((await audit.query()).entries.map((e) => e.trigger)).toEqual(['rule.deleted', 'rule.toggled']);
  });

  it('simulates facts and rejects bad facts by name', async () => {
    const { call } = setup();
    const ok = await call('simulate_rules', { facts: { event: 'rental.created' } });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ matched: [{ ruleId: 'desk-welcome-back' }] });
    expect((ok.data as { compiled: string }).compiled).toContain('### Welcome back');
    const bad = await call('simulate_rules', { facts: { event: 'nope' } });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain('event');
  });

  it('checks conflicts without the model unless asked', async () => {
    const { call, client } = setup();
    const r = await call('check_conflicts', {});
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ summary: 'No conflicts among 1 rules.' });
    expect(client.calls).toHaveLength(0);
  });

  it('turns parse failures into error results', async () => {
    const store = createInMemoryRuleStore<D>();
    const set = ruleTools<Ctx, D>({ engine: { dims, client: createFakeModelClient([{ object: { nonsense: true } }]), now }, store, actorFromCtx: () => ref('User', 'x') });
    const r = await createToolRegistry(set.tools).get('propose_rule')!.execute({ text: 'x' } as never, { ctx: { sessionId: 's', manager: 'x' }, toolUseId: 't', sessionId: 's' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Structured output');
  });
});
