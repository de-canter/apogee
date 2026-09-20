import { composePrompt, definePrompt, slot, text } from '@de_canter/apogee-prompts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compileRules, formatRule, rulesContributor } from '../compile';
import { defineDimensions } from '../dimensions';
import { defineRule } from '../rule';

const dims = defineDimensions({ event: z.enum(['created', 'returned']), tier: z.enum(['standard', 'high']) });

const deposit = defineRule(dims, {
  id: 'deposit', name: 'Deposit note', category: 'gate', priority: 200,
  conditions: { event: ['created'], tier: ['high'], naturalLanguage: 'the customer is not a franchise account' },
  instruction: 'Ask for a deposit and record it with add_note before confirming.',
  suggestedActions: ['add_deposit_note', 'waive_deposit'], defaultAction: 'add_deposit_note',
});
const welcome = defineRule(dims, { id: 'welcome', name: 'Welcome back', category: 'desk', conditions: {}, instruction: 'Greet returning customers by name.' });
const returned = defineRule(dims, { id: 'returned', name: 'Return check', category: 'desk', conditions: { event: ['returned'] }, instruction: 'Inspect on return.' });
const tierOnly = defineRule(dims, { id: 'tier', name: 'High value', category: 'desk', conditions: { tier: ['high'] }, instruction: 'Mention insurance.' });

describe('formatRule', () => {
  it('renders name, applicability, instruction, and actions', () => {
    expect(formatRule(deposit)).toBe(
      `### Deposit note

Applies when: event is created; tier is high; and the customer is not a franchise account

Ask for a deposit and record it with add_note before confirming.

**Available actions:**
1. \`add_deposit_note\` (recommended)
2. \`waive_deposit\``,
    );
  });
  it('omits the applicability line and actions for an unconditional rule without actions', () => {
    expect(formatRule(welcome)).toBe('### Welcome back\n\nGreet returning customers by name.');
  });
  it('joins alternatives with or', () => {
    const r = defineRule(dims, { id: 'x', name: 'X', category: 'desk', conditions: { event: ['created', 'returned'] }, instruction: 'i' });
    expect(formatRule(r)).toContain('Applies when: event is created or returned');
  });
});

describe('compileRules', () => {
  it('includes matching rules, passes unknown facts by default, and sorts by priority', () => {
    const c = compileRules([welcome, deposit, returned, tierOnly], { event: 'created' });
    expect(c.ruleIds).toEqual(['deposit', 'tier', 'welcome']);
    expect(c.ruleCount).toBe(3);
    expect(c.text.startsWith('## Business rules\n\n### Deposit note')).toBe(true);
    expect(c.text).not.toContain('Return check');
  });
  it('supports heading, intro, category, and strict facts', () => {
    const c = compileRules([welcome, deposit, tierOnly], { event: 'created' }, { heading: '## Desk rules', intro: 'Follow these.', category: 'desk', unknownFacts: 'fail' });
    expect(c.ruleIds).toEqual(['welcome']);
    expect(c.text).toBe('## Desk rules\n\nFollow these.\n\n### Welcome back\n\nGreet returning customers by name.');
  });
  it('is empty when nothing matches', () => {
    expect(compileRules([returned], { event: 'created' })).toEqual({ text: '', ruleIds: [], ruleCount: 0 });
  });
});

describe('rulesContributor', () => {
  const prompt = definePrompt<{ event?: 'created' | 'returned' }>({ name: 'p', version: '1.0.0', sections: [text('id', 'Identity.'), slot('rules', 'rules')] });
  it('fills a prompt slot from an async rule source and the context facts', async () => {
    const contributor = rulesContributor<{ event?: 'created' | 'returned' }, typeof dims.shape>({
      rules: () => Promise.resolve([welcome, returned]),
      factsFromCtx: (ctx) => (ctx.event ? { event: ctx.event } : {}),
      heading: '## Desk rules',
    });
    const composed = await composePrompt(prompt, { event: 'returned' }, { contributors: { rules: contributor } });
    expect(composed.text).toContain('## Desk rules');
    expect(composed.text).toContain('### Return check');
    expect(composed.blocks.map((b) => b.id)).toEqual(['id', 'rules']);
  });
  it('passes the context to the rule source so a host can scope rules per tenant', async () => {
    const seen: string[] = [];
    const contributor = rulesContributor<{ tenant: string }, typeof dims.shape>({
      rules: (ctx) => { seen.push(ctx.tenant); return ctx.tenant === 'a' ? [welcome] : []; },
      factsFromCtx: () => ({}),
    });
    expect(await contributor({ tenant: 'a' })).toContain('Welcome back');
    expect(await contributor({ tenant: 'b' })).toBeUndefined();
    expect(seen).toEqual(['a', 'b']);
  });

  it('contributes nothing when no rule matches', async () => {
    const contributor = rulesContributor<{ event?: 'created' | 'returned' }, typeof dims.shape>({ rules: () => [returned], factsFromCtx: () => ({ event: 'created' }) });
    expect(await contributor({ event: 'created' })).toBeUndefined();
  });
});
