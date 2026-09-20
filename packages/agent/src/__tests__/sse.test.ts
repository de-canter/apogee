import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events';
import { SSE_HEADERS, agentEventsToReadableStream, encodeAgentEvent, pipeAgentEventsToNode } from '../sse';

const events: AgentEvent[] = [
  { type: 'text_delta', text: 'hi' },
  { type: 'tool_call', toolUseId: 't1', name: 'x', input: {} },
  { type: 'turn_end', message: { id: 'm', role: 'assistant', content: 'hi', at: isoDate('2026-01-01') }, usage: { model: 'claude-opus-5', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 }, rounds: 1, stopReason: 'end_turn' },
];
async function* feed(evs: AgentEvent[], throwAfter?: number): AsyncIterable<AgentEvent> {
  for (const [i, e] of evs.entries()) {
    await Promise.resolve();
    if (throwAfter !== undefined && i === throwAfter) throw Object.assign(new Error('boom'), { code: 'OVERLOADED' });
    yield e;
  }
}
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text.split('\n\n').filter((s) => s !== '');
}

describe('sse', () => {
  it('encodes one frame per event', () => {
    expect(encodeAgentEvent(events[0]!)).toBe('data: {"type":"text_delta","text":"hi"}\n\n');
  });
  it('ReadableStream round-trips events and appends an error frame on failure', async () => {
    const frames = await readAll(agentEventsToReadableStream(feed(events)));
    expect(frames).toHaveLength(3);
    expect(JSON.parse(frames[2]!.slice('data: '.length))).toEqual(events[2]);
    const failed = await readAll(agentEventsToReadableStream(feed(events, 1)));
    expect(failed).toHaveLength(2);
    expect(JSON.parse(failed[1]!.slice(6))).toEqual({ type: 'error', error: { code: 'OVERLOADED', message: 'boom' } });
  });
  it('pipes to a Node response with headers and ends', async () => {
    const calls: string[] = [];
    const res = { writeHead: (s: number, h: Record<string, string>) => calls.push(`head:${s}:${h['Content-Type'] ?? ''}:${h['X-Extra'] ?? ''}`), write: (c: string) => calls.push(c), end: () => calls.push('end') };
    await pipeAgentEventsToNode(feed(events), res, { 'X-Extra': '1' });
    expect(calls[0]).toBe(`head:200:${SSE_HEADERS['Content-Type']}:1`);
    expect(calls).toHaveLength(5);
    expect(calls[4]).toBe('end');
    const failing: string[] = [];
    await pipeAgentEventsToNode(feed(events, 0), { writeHead: () => 0, write: (c: string) => failing.push(c), end: () => failing.push('end') });
    expect(failing[0]).toContain('"type":"error"');
    expect(failing[1]).toBe('end');
  });
});
