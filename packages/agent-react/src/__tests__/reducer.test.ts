import type { AgentEvent, AgentMessage } from '@de_canter/apogee-agent';
import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { displayMessages, initialAgentUiState, reduceAgentState, type AgentUiState } from '../reducer';

const at = isoDate('2026-01-01');
const usage = { model: 'claude-opus-5', input: 10, output: 5, cacheRead: 2, cacheWrite: 0, costUsd: 0.001 };
const final: AgentMessage = { id: 'a1', role: 'assistant', content: 'Done.', artifacts: [{ type: 'note-card', id: 'n1', data: {} }], at };
const seq: AgentEvent[] = [
  { type: 'text_delta', text: 'Add' }, { type: 'text_delta', text: 'ing.' },
  { type: 'tool_call', toolUseId: 'tu1', name: 'add_note', input: { text: 'x' } },
  { type: 'tool_result', toolUseId: 'tu1', name: 'add_note', result: { success: true }, durationMs: 3, isError: false },
  { type: 'artifact', toolUseId: 'tu1', artifact: { type: 'note-card', id: 'n1', data: {} } },
  { type: 'text_delta', text: 'Done.' },
  { type: 'turn_end', message: final, usage, rounds: 2, stopReason: 'end_turn' },
];
const run = (events: AgentEvent[], start = initialAgentUiState()): AgentUiState => events.reduce((s, e) => reduceAgentState(s, { type: 'event', event: e, now: 100 }), start);

describe('reduceAgentState', () => {
  it('walks a tool turn: streaming text, active tool, cleared on result, final message on turn_end', () => {
    let s = reduceAgentState(initialAgentUiState(), { type: 'send', message: { id: 'u1', role: 'user', content: 'add x', at } });
    expect(s.isStreaming).toBe(true);
    s = run(seq.slice(0, 3), s);
    expect(s.streamingText).toBe('Adding.');
    expect(s.activeTools).toEqual([{ toolUseId: 'tu1', name: 'add_note', input: { text: 'x' }, startedAt: 100 }]);
    expect(displayMessages(s, () => at).at(-1)).toMatchObject({ id: 'streaming', streaming: true, content: 'Adding.' });
    s = run(seq.slice(3, 6), s);
    expect(s.activeTools).toEqual([]);
    expect(s.streamingText).toBe('Done.');
    s = run(seq.slice(6), s);
    expect(s.isStreaming).toBe(false);
    expect(s.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(s.lastUsage).toEqual(usage);
    expect(s.totalUsage).toEqual({ input: 10, output: 5, cacheRead: 2, cacheWrite: 0, costUsd: 0.001 });
    expect(displayMessages(s, () => at)).toHaveLength(2);
    s = run(seq.slice(6), s);
    expect(s.totalUsage.input).toBe(20);
  });
  it('error clears streaming and records the error; reset restores; hidden messages are filtered', () => {
    let s = reduceAgentState(initialAgentUiState(), { type: 'send', message: { id: 'u', role: 'user', content: 'x', at } });
    s = run([{ type: 'tool_call', toolUseId: 't', name: 'n', input: {} }, { type: 'error', error: { code: 'OVERLOADED', message: 'down' } }], s);
    expect(s.isStreaming).toBe(false);
    expect(s.activeTools).toEqual([]);
    expect(s.error).toEqual({ code: 'OVERLOADED', message: 'down' });
    const r = reduceAgentState(s, { type: 'reset', messages: [{ id: 'h', role: 'assistant', content: 'hidden', hidden: true, at }, final] });
    expect(r.messages.map((m) => m.id)).toEqual(['a1']);
    expect(r.error).toBeUndefined();
  });
});
