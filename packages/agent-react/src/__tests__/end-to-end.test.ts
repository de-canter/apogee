import { agentEventsToReadableStream, createAgentSession, createInMemoryMemory, createInMemoryMessageStore, defineTool, memoryContributor, memoryTool, type TelemetryEvent } from '@apogee/agent';
import { createFakeModelClient, type SystemBlock } from '@apogee/ai';
import { definePrompt, fromContext, slot, text } from '@apogee/prompts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { initialAgentUiState, reduceAgentState, type AgentUiState } from '../reducer';
import { decodeSseStream } from '../sse-decoder';

interface Ctx { tenant: string; notes: string[] }

const prompt = definePrompt<Ctx>({
  name: 'rental-desk', version: '1.0.0',
  sections: [text('id', 'You run the rental desk.'), fromContext('tenant', (c) => `Tenant: ${c.tenant}`, { stable: true }), slot('memory', 'memory')],
});
const addNote = defineTool<Ctx, { text: string }>({
  name: 'add_note', description: 'Add a note', input: z.object({ text: z.string() }),
  execute: (i, { ctx, toolUseId }) => { ctx.notes.push(i.text); return Promise.resolve({ success: true, artifact: { type: 'note-card', id: `note-card-${toolUseId}`, data: { text: i.text } } }); },
});
const listNotes = defineTool<Ctx, Record<string, never>>({
  name: 'list_notes', description: 'List notes', input: z.object({}),
  execute: (_i, { ctx }) => Promise.resolve({ success: true, data: ctx.notes }),
});

async function drain(events: AsyncIterable<unknown>): Promise<number> {
  let n = 0;
  for await (const e of events) if (e !== undefined) n++;
  return n;
}

describe('end to end: session → SSE → decoder → reducer', () => {
  it('three turns with tools, memory, persistence, and telemetry reach the UI state intact', async () => {
    const port = createInMemoryMemory<string>((k) => k);
    const memory = memoryTool<Ctx, string>({ port, keyFromCtx: (c) => c.tenant, byFromCtx: () => 'agent' });
    const client = createFakeModelClient([
      { text: 'Noting that.', toolUses: [{ id: 'tu1', name: 'add_note', input: { text: 'forklift due back Friday' } }], usage: { input: 100, output: 10 } },
      { text: 'Noted: forklift due back Friday.', usage: { input: 150, output: 12 } },
      { toolUses: [{ id: 'tu2', name: 'update_memory', input: { content: 'Customer prefers Friday returns.' } }] },
      { text: 'Remembered.' },
      { text: 'You prefer Friday returns.', usage: { input: 200, output: 8 } },
    ]);
    const store = createInMemoryMessageStore();
    const telemetry: TelemetryEvent[] = [];
    const session = createAgentSession<Ctx>({
      sessionId: 'e2e', client, prompt, tools: [addNote, listNotes, memory],
      contributors: { memory: memoryContributor<Ctx, string>({ port, keyFromCtx: (c) => c.tenant }) },
      ctx: { tenant: 'acme-rentals', notes: [] }, messages: store, telemetry: (e) => { telemetry.push(e); },
    });

    // Turns 1 and 2 in-process.
    await drain(session.run('note: forklift due back Friday'));
    await drain(session.run('remember I like Friday returns'));

    // Turn 3 over the wire.
    const body = agentEventsToReadableStream(session.run('what do I prefer?'));
    let ui: AgentUiState = initialAgentUiState();
    for await (const ev of decodeSseStream(body)) ui = reduceAgentState(ui, { type: 'event', event: ev });

    const persisted = await store.list('e2e');
    const finalPersisted = persisted[persisted.length - 1]!;
    expect(ui.messages[ui.messages.length - 1]).toEqual(finalPersisted);
    expect(ui.messages[ui.messages.length - 1]?.content).toBe('You prefer Friday returns.');
    expect(ui.isStreaming).toBe(false);
    expect(ui.lastUsage?.input).toBe(200);

    const thirdSystem = (client.calls[4]?.system as SystemBlock[]).map((b) => b.text).join('\n');
    expect(thirdSystem).toContain('Customer prefers Friday returns.');
    const visible = persisted.filter((m) => !m.hidden);
    expect(visible.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(visible[1]?.artifacts?.[0]).toMatchObject({ type: 'note-card', id: 'note-card-tu1' });
    expect(visible[1]?.toolCalls?.[0]?.toolUseId).toBe('tu1');
    expect(telemetry.map((t) => t.type)).toContain('tool_complete');
    expect(telemetry.filter((t) => t.type === 'turn_end')).toHaveLength(3);
    expect(client.usage.total().calls).toBe(5);
  });
});
