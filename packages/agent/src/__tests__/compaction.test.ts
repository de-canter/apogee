import { createFakeModelClient } from '@apogee/ai';
import { isoDate } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { compactHistory, estimateHistoryTokens, pruneToBudget } from '../compaction';
import type { AgentMessage } from '../messages';

const at = isoDate('2026-01-01');
const msg = (i: number, size = 4000): AgentMessage => ({ id: String(i), role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i} ` + 'x'.repeat(size), at });
const history = Array.from({ length: 20 }, (_, i) => msg(i));

describe('compactHistory', () => {
  it('summarizes older messages into one summary and keeps recent pairs', async () => {
    const client = createFakeModelClient([{ text: 'SUMMARY', usage: { input: 5000, output: 50 } }]);
    const r = await compactHistory(history, { client, budgetTokens: 10_000, now: () => at });
    expect(r.compacted).toBe(true);
    expect(r.history).toHaveLength(13);
    expect(r.history[0]).toMatchObject({ role: 'summary', content: 'SUMMARY' });
    expect(r.history.slice(1).map((m) => m.id)).toEqual(history.slice(8).map((m) => m.id));
    const sent = client.calls[0]!;
    const text = sent.messages[0]!.content as string;
    expect(text).toContain('User: m0');
    expect(text).toContain('Assistant: m1');
    expect(text).not.toContain('m8 ');
    expect(sent.model).toBe('fast');
    const system = sent.system as Array<{ text: string; cache?: boolean }>;
    expect(system).toHaveLength(1);
    expect(system[0]?.text).toContain('Summarize this conversation history');
    expect(system[0]?.cache).toBe(true);
  });
  it('compounds a prior summary into the next one', async () => {
    const client = createFakeModelClient([{ text: 'S2' }]);
    const withSummary: AgentMessage[] = [{ id: 's', role: 'summary', content: 'S1', at }, ...history];
    const r = await compactHistory(withSummary, { client, budgetTokens: 10_000 });
    expect((client.calls[0]!.messages[0]!.content as string)).toContain('[Previous Summary]: S1');
    expect(r.history.filter((m) => m.role === 'summary')).toHaveLength(1);
  });
  it('leaves history alone below threshold, when too short, or on an empty summary', async () => {
    const client = createFakeModelClient([{ text: '' }]);
    expect((await compactHistory(history, { client, budgetTokens: 1_000_000 })).compacted).toBe(false);
    expect(client.calls).toHaveLength(0);
    expect((await compactHistory(history.slice(0, 10), { client, budgetTokens: 10 })).compacted).toBe(false);
    const empty = await compactHistory(history, { client, budgetTokens: 10_000 });
    expect(empty.compacted).toBe(false);
    expect(empty.history).toHaveLength(20);
  });
  it('estimates tokens over blocks and prunes pairwise to a hard budget', () => {
    const blocks: AgentMessage = { id: 'b', role: 'assistant', content: '', blocks: [{ type: 'text', text: 'x'.repeat(40) }, { type: 'tool_use', id: 't', name: 'n', input: { a: 1 } }], at };
    expect(estimateHistoryTokens([blocks])).toBeGreaterThanOrEqual(12);
    const pruned = pruneToBudget(history, 5000);
    expect(pruned.length).toBeLessThan(20);
    expect(pruned.length % 2).toBe(0);
    expect(pruned[0]?.role).toBe('user');
  });
});
