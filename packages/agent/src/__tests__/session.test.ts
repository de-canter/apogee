import { createFakeModelClient, AiError, type SystemBlock } from '@apogee/ai';
import { isoDate } from '@apogee/kernel';
import { definePrompt, fromContext, slot, text } from '@apogee/prompts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AgentEvent } from '../events';
import { createInMemoryMemory, memoryContributor, memoryTool } from '../memory';
import type { AgentMessage } from '../messages';
import { createAgentSession } from '../session';
import { createInMemoryMessageStore, createInMemorySessionStore } from '../stores';
import type { TelemetryEvent } from '../telemetry';
import { defineTool } from '../tool';

interface Ctx { tenant: string; notes: string[] }
const at = isoDate('2026-01-01');
const prompt = definePrompt<Ctx>({
  name: 'notes', version: '1.0.0',
  sections: [text('id', 'You manage notes.'), fromContext('tenant', (c) => `Tenant: ${c.tenant}`, { stable: true }), slot('memory', 'memory')],
});
const addNote = defineTool<Ctx, { text: string }>({
  name: 'add_note', description: 'Add a note', input: z.object({ text: z.string().min(1) }),
  execute: (input, { ctx, toolUseId }) => {
    ctx.notes.push(input.text);
    return Promise.resolve({ success: true, message: 'added', artifact: { type: 'note-card', id: `note-card-${toolUseId}`, data: { text: input.text } } });
  },
});
const explode = defineTool<Ctx, Record<string, never>>({
  name: 'explode', description: 'Throws', input: z.object({}),
  execute: () => Promise.reject(new Error('kaboom')),
});
const ctx = (): Ctx => ({ tenant: 'acme', notes: [] });
async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}
const turnEnd = (events: AgentEvent[]) => {
  const e = events[events.length - 1];
  if (!e || e.type !== 'turn_end') throw new Error(`expected turn_end, got ${e?.type ?? 'nothing'}`);
  return e;
};

describe('createAgentSession', () => {
  it('(a) plain turn: streams text, persists user and assistant with usage', async () => {
    const client = createFakeModelClient([{ text: 'Hello there', usage: { input: 100, output: 10 } }]);
    const session = createAgentSession({ sessionId: 's1', client, prompt, ctx: ctx(), now: () => at });
    const events = await collect(session.run('hi'));
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'text_delta', 'turn_end']);
    const end = turnEnd(events);
    expect(end.rounds).toBe(1);
    expect(end.stopReason).toBe('end_turn');
    expect(end.message).toMatchObject({ role: 'assistant', content: 'Hello there' });
    expect(end.usage.input).toBe(100);
    expect(session.history().map((m) => m.role)).toEqual(['user', 'assistant']);
    const system = client.calls[0]?.system as SystemBlock[];
    expect(system.map((b) => b.text)).toEqual(['You manage notes.', 'Tenant: acme']);
    expect(system[1]?.cache).toBe(true);
    expect(client.calls[0]?.tools).toBeUndefined();
  });

  it('(b) tool round: tool_call, tool_result, artifact, then turn_end with summed usage and faithful replay', async () => {
    const client = createFakeModelClient([
      { text: 'Adding.', toolUses: [{ id: 'tu1', name: 'add_note', input: { text: 'milk' } }], usage: { input: 50, output: 5 } },
      { text: 'Done.', usage: { input: 80, output: 3 } },
    ]);
    const c = ctx();
    const store = createInMemoryMessageStore();
    const session = createAgentSession({ sessionId: 's2', client, prompt, tools: [addNote], ctx: c, messages: store, now: () => at });
    const events = await collect(session.run('add milk'));
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'tool_call', 'tool_result', 'artifact', 'text_delta', 'turn_end']);
    expect(events[2]).toEqual({ type: 'tool_call', toolUseId: 'tu1', name: 'add_note', input: { text: 'milk' } });
    const tr = events[3];
    expect(tr?.type === 'tool_result' && tr.isError).toBe(false);
    expect(tr?.type === 'tool_result' && tr.result.message).toBe('added');
    expect(events[4]).toEqual({ type: 'artifact', toolUseId: 'tu1', artifact: { type: 'note-card', id: 'note-card-tu1', data: { text: 'milk' } } });
    const end = turnEnd(events);
    expect(end.rounds).toBe(2);
    expect(end.usage).toMatchObject({ input: 130, output: 8 });
    expect(end.message.toolCalls?.map((t) => t.name)).toEqual(['add_note']);
    expect(end.message.artifacts).toHaveLength(1);
    expect(c.notes).toEqual(['milk']);
    const replay = client.calls[1]!.messages;
    expect(replay.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(replay[1]?.content).toEqual([{ type: 'text', text: 'Adding.' }, { type: 'tool_use', id: 'tu1', name: 'add_note', input: { text: 'milk' } }]);
    expect(replay[2]?.content).toEqual([{ type: 'tool_result', toolUseId: 'tu1', content: expect.any(String) as string }]);
    expect(client.calls[0]?.tools?.map((t) => t.name)).toEqual(['add_note']);
    const persisted = await store.list('s2');
    expect(persisted.map((m) => [m.role, m.hidden ?? false])).toEqual([['user', false], ['assistant', true], ['user', true], ['assistant', false]]);
  });

  it('(c)(d) tool throw, unknown tool, invalid input become is_error results, never exceptions', async () => {
    const client = createFakeModelClient([
      { toolUses: [{ id: 'a', name: 'explode', input: {} }, { id: 'b', name: 'nope', input: {} }, { id: 'c', name: 'add_note', input: { text: '' } }] },
      { text: 'Recovered.' },
    ]);
    const session = createAgentSession({ sessionId: 's3', client, prompt, tools: [addNote, explode], ctx: ctx() });
    const events = await collect(session.run('go'));
    const results = events.filter((e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result');
    expect(results.map((r) => [r.toolUseId, r.isError])).toEqual([['a', true], ['b', true], ['c', true]]);
    expect(results[0]?.result.error).toBe('Error: kaboom');
    expect(results[1]?.result.error).toContain('not found');
    expect(results[2]?.result.error).toContain('invalid input');
    const blocks = client.calls[1]!.messages[2]!.content as Array<{ type: string; isError?: boolean; content: string }>;
    expect(blocks.every((b) => b.type === 'tool_result' && b.isError === true && b.content.includes('Error:'))).toBe(true);
    expect(turnEnd(events).stopReason).toBe('end_turn');
  });

  it('(e) max rounds ends the turn with the fallback message', async () => {
    const client = createFakeModelClient((_r, i) => ({ toolUses: [{ id: `t${i}`, name: 'add_note', input: { text: `n${i}` } }] }));
    const session = createAgentSession({ sessionId: 's4', client, prompt, tools: [addNote], ctx: ctx(), maxRounds: 2, maxRoundsMessage: 'Stopped.' });
    const end = turnEnd(await collect(session.run('loop')));
    expect(end.stopReason).toBe('max_rounds');
    expect(end.rounds).toBe(2);
    expect(end.message.content).toBe('Stopped.');
    expect(end.message.toolCalls).toHaveLength(2);
    expect(client.calls).toHaveLength(2);
  });

  it('(f) annotations reach the model but stay separate in the stored message', async () => {
    const client = createFakeModelClient([{ text: 'ok' }]);
    const session = createAgentSession({ sessionId: 's5', client, prompt, ctx: ctx() });
    await collect(session.run('Add party', { annotations: ['[Artifact Action: submit on party-form-1]'] }));
    expect(client.calls[0]?.messages[0]?.content).toBe('Add party\n\n[Artifact Action: submit on party-form-1]');
    expect(session.history()[0]).toMatchObject({ content: 'Add party', annotations: ['[Artifact Action: submit on party-form-1]'] });
  });

  it('(g) restored history is replayed', async () => {
    const client = createFakeModelClient([{ text: 'and again' }]);
    const history: AgentMessage[] = [{ id: '1', role: 'user', content: 'first', at }, { id: '2', role: 'assistant', content: 'reply', at }];
    const session = createAgentSession({ sessionId: 's6', client, prompt, ctx: ctx(), history });
    await collect(session.run('second'));
    expect(client.calls[0]?.messages.map((m) => m.content)).toEqual(['first', 'reply', 'second']);
    expect(session.history()).toHaveLength(4);
  });

  it('(h) memory tool + contributor round trip into the next system prompt', async () => {
    const port = createInMemoryMemory<string>((k) => k);
    const tool = memoryTool<Ctx, string>({ port, keyFromCtx: (c) => c.tenant, byFromCtx: () => 'agent' });
    const contributors = { memory: memoryContributor<Ctx, string>({ port, keyFromCtx: (c) => c.tenant }) };
    const client = createFakeModelClient([
      { toolUses: [{ id: 'm1', name: 'update_memory', input: { content: 'Remember: milk first.' } }] },
      { text: 'Saved.' },
      { text: 'Yes.' },
    ]);
    const session = createAgentSession({ sessionId: 's7', client, prompt, tools: [tool], contributors, ctx: ctx() });
    await collect(session.run('remember milk'));
    await collect(session.run('do you remember?'));
    const systems = client.calls.map((c) => (c.system as SystemBlock[]).map((b) => b.text).join('\n'));
    expect(systems[0]).not.toContain('Remember: milk first.');
    expect(systems[1]).toContain('## Design Memory\n\nRemember: milk first.');
    expect(systems[2]).toContain('Remember: milk first.');
  });

  it('(i) telemetry records the turn in order and sessions are touched', async () => {
    const sink = vi.fn<(e: TelemetryEvent) => void>();
    const sessions = createInMemorySessionStore();
    await sessions.create({ id: 's8', ownerId: 'u', title: 'T', context: {} });
    const client = createFakeModelClient([{ toolUses: [{ id: 't', name: 'add_note', input: { text: 'a' } }] }, { text: 'done' }]);
    const session = createAgentSession({ sessionId: 's8', client, prompt, tools: [addNote], ctx: ctx(), telemetry: sink, sessions });
    session.setContext({ tenant: 'beta' });
    await collect(session.run('x'));
    expect(sink.mock.calls.map((c) => c[0].type)).toEqual(['context_change', 'user_message', 'tool_start', 'tool_complete', 'artifact', 'assistant_message', 'turn_end']);
    expect((await sessions.get('s8'))?.messageCount).toBe(4);
  });

  it('(j) a model error surfaces as an error event and persists no assistant message', async () => {
    const client = createFakeModelClient([{ error: new AiError('down', 'OVERLOADED', true) }]);
    const session = createAgentSession({ sessionId: 's9', client, prompt, ctx: ctx() });
    const events = await collect(session.run('hi'));
    expect(events).toEqual([{ type: 'error', error: { code: 'OVERLOADED', message: 'down' } }]);
    expect(session.history().map((m) => m.role)).toEqual(['user']);
  });

  it('(k) refusal ends the turn with stopReason refusal', async () => {
    const client = createFakeModelClient([{ text: '', stopReason: 'refusal' }]);
    const session = createAgentSession({ sessionId: 's10', client, prompt, ctx: ctx() });
    expect(turnEnd(await collect(session.run('hi'))).stopReason).toBe('refusal');
  });

  it('(l) compaction runs before the turn and persists the replaced history', async () => {
    const client = createFakeModelClient([{ text: 'SUM' }, { text: 'ok' }]);
    const store = createInMemoryMessageStore();
    const history: AgentMessage[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i), role: i % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(4000), at }));
    const session = createAgentSession({ sessionId: 's11', client, prompt, ctx: ctx(), history, messages: store, compaction: { budgetTokens: 10_000 } });
    await collect(session.run('next'));
    expect(session.history()[0]?.role).toBe('summary');
    expect((await store.list('s11'))[0]?.role).toBe('summary');
    expect(client.calls[0]?.messages[0]?.content).toContain('Here is the conversation history to summarize');
  });
});
