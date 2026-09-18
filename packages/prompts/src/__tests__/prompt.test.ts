import { describe, expect, it } from 'vitest';
import { PromptDefinitionError, composePrompt, definePrompt, fromContext, slot, text, toSystemBlocks } from '../prompt';

interface Ctx { tenant?: string; now: string }

const prompt = definePrompt<Ctx>({
  name: 'assistant',
  version: '1.0.0',
  sections: [
    text('identity', 'You are X'),
    text('rules', 'Rules...'),
    fromContext('tenant', (c) => (c.tenant ? `Tenant: ${c.tenant}` : undefined)),
    slot('behavior', 'behavior-rules'),
    fromContext('now', (c) => `Now ${c.now}`),
  ],
});

describe('composePrompt', () => {
  it('renders in order, drops empties, and puts one breakpoint at the end of the stable prefix', async () => {
    const c = await composePrompt(prompt, { tenant: 'Acme', now: 't' }, { contributors: { 'behavior-rules': () => 'R1' } });
    expect(c.blocks.map((b) => [b.id, b.cache])).toEqual([['identity', false], ['rules', true], ['tenant', false], ['behavior', false], ['now', false]]);
    expect(c.cacheBoundary).toBe(2);
    expect(c.text).toBe(['You are X', 'Rules...', 'Tenant: Acme', 'R1', 'Now t'].join('\n\n---\n\n'));
    expect(toSystemBlocks(c)).toEqual([{ text: 'You are X' }, { text: 'Rules...', cache: true }, { text: 'Tenant: Acme' }, { text: 'R1' }, { text: 'Now t' }]);
  });
  it('drops sections with no tenant and no contributor; boundary unchanged', async () => {
    const c = await composePrompt(prompt, { now: 't' });
    expect(c.blocks.map((b) => b.id)).toEqual(['identity', 'rules', 'now']);
    expect(c.cacheBoundary).toBe(2);
  });
  it('a stable context section joins the prefix; async contributors are awaited; separator is configurable', async () => {
    const p = definePrompt<Ctx>({ name: 'p', version: '0.1.0', sections: [text('a', 'A'), fromContext('b', () => 'B', { stable: true }), slot('c', 'x'), text('d', 'D')] });
    const c = await composePrompt(p, { now: 't' }, { contributors: { x: () => Promise.resolve('C') }, separator: '\n' });
    expect(c.blocks.map((b) => [b.id, b.cache])).toEqual([['a', false], ['b', true], ['c', false], ['d', false]]);
    expect(c.text).toBe('A\nB\nC\nD');
  });
  it('an all-volatile prompt has no breakpoint; an all-stable one caches the last block', async () => {
    const v = await composePrompt(definePrompt<Ctx>({ name: 'v', version: '0.0.1', sections: [fromContext('n', (c) => c.now)] }), { now: 't' });
    expect(v.cacheBoundary).toBe(0);
    expect(v.blocks[0]?.cache).toBe(false);
    const s = await composePrompt(definePrompt({ name: 's', version: '0.0.1', sections: [text('a', 'A'), text('b', 'B')] }), {});
    expect(s.cacheBoundary).toBe(2);
    expect(s.blocks[1]?.cache).toBe(true);
  });
});

describe('definePrompt', () => {
  it('rejects bad versions, empty names, and duplicate ids', () => {
    expect(() => definePrompt({ name: '', version: '1.0.0', sections: [] })).toThrow(PromptDefinitionError);
    expect(() => definePrompt({ name: 'x', version: 'v1', sections: [] })).toThrow(PromptDefinitionError);
    expect(() => definePrompt({ name: 'x', version: '1.0.0', sections: [text('a', 'A'), text('a', 'B')] })).toThrow(PromptDefinitionError);
  });
});
