import { createFakeModelClient } from '@apogee/ai';
import { describe, expect, it } from 'vitest';
import { evalPrompt, includesJudge } from '../eval';
import { definePrompt, fromContext, text } from '../prompt';

interface Ctx { tenant: string }
const prompt = definePrompt<Ctx>({ name: 'greet', version: '1.0.0', sections: [text('id', 'You greet people.'), fromContext('t', (c) => `Tenant ${c.tenant}`)] });

describe('evalPrompt', () => {
  it('composes per case, calls the client with system blocks, scores, and totals cost', async () => {
    const client = createFakeModelClient([{ text: 'Hello Acme!', usage: { input: 100, output: 10 } }, { text: 'Goodbye', usage: { input: 100, output: 10 } }]);
    const report = await evalPrompt(prompt, [
      { id: 'a', ctx: { tenant: 'Acme' }, input: 'hi', expect: 'hello acme' },
      { id: 'b', ctx: { tenant: 'Beta' }, input: 'hi', expect: 'hello beta' },
    ], { client, role: 'fast' });
    expect(report.cases.map((c) => c.score)).toEqual([1, 0]);
    expect(report.meanScore).toBe(0.5);
    expect(report.cases[1]?.notes).toContain('hello beta');
    expect(report.totalCostUsd).toBeCloseTo(2 * (100 * 1 + 10 * 5) / 1e6, 12);
    expect(client.calls[0]?.system).toEqual([{ text: 'You greet people.', cache: true }, { text: 'Tenant Acme' }]);
    expect(client.calls[0]?.model).toBe('fast');
    expect(client.usage.records()[0]?.label).toBe('eval:greet@1.0.0:a');
  });
  it('supports a custom judge and empty case lists', async () => {
    const client = createFakeModelClient([{ text: 'x' }]);
    const report = await evalPrompt(prompt, [{ id: 'a', ctx: { tenant: 'T' }, input: 'q' }], { client, judge: () => ({ score: 0.25, notes: 'meh' }) });
    expect(report.cases[0]).toMatchObject({ score: 0.25, notes: 'meh' });
    expect((await evalPrompt(prompt, [], { client })).meanScore).toBe(0);
    expect((await includesJudge({ id: 'z', ctx: {}, input: '' }, 'anything')).score).toBe(1);
  });
});
