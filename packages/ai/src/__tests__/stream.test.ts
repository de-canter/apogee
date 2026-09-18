import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createCatalog } from '../catalog';
import { normalizeStream } from '../stream';
import type { ModelEvent } from '../types';

type Ev = Anthropic.MessageStreamEvent;

const start = (input = 10, cacheRead = 2): Ev => ({
  type: 'message_start',
  message: {
    id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, stop_details: null,
    usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, cache_creation: null, server_tool_use: null, service_tier: null, inference_geo: null, iterations: null, speed: null },
  } as unknown as Anthropic.Message,
});
const textStart = (i: number): Ev => ({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '', citations: null } });
const textDelta = (i: number, text: string): Ev => ({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text } });
const toolStart = (i: number): Ev => ({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: 't1', name: 'lookup', input: {} } as unknown as Anthropic.ContentBlock });
const jsonDelta = (i: number, partial_json: string): Ev => ({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json } });
const stop = (i: number): Ev => ({ type: 'content_block_stop', index: i });
const msgDelta = (stop_reason: Anthropic.StopReason, output = 7): Ev => ({
  type: 'message_delta',
  delta: { stop_reason, stop_sequence: null, stop_details: null, container: null },
  usage: { output_tokens: output, input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, server_tool_use: null, iterations: null },
} as unknown as Ev);
const msgStop: Ev = { type: 'message_stop' };

async function* feed(events: Ev[]): AsyncIterable<Ev> { for (const e of events) { await Promise.resolve(); yield e; } }
async function collect(events: Ev[]): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of normalizeStream(feed(events), { model: 'claude-opus-5', catalog: createCatalog() })) out.push(e);
  return out;
}

describe('normalizeStream', () => {
  it('emits text, tool events with parsed input, and a priced message_end', async () => {
    const out = await collect([start(), textStart(0), textDelta(0, 'Hel'), textDelta(0, 'lo'), stop(0), toolStart(1), jsonDelta(1, '{"q":'), jsonDelta(1, '1}'), stop(1), msgDelta('tool_use'), msgStop]);
    expect(out.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'tool_use_start', 'tool_use_delta', 'tool_use_delta', 'tool_use_end', 'message_end']);
    expect(out[5]).toEqual({ type: 'tool_use_end', id: 't1', name: 'lookup', input: { q: 1 } });
    const end = out[6]!;
    if (end.type !== 'message_end') throw new Error('expected message_end');
    expect(end.text).toBe('Hello');
    expect(end.toolUses).toEqual([{ id: 't1', name: 'lookup', input: { q: 1 } }]);
    expect(end.stopReason).toBe('tool_use');
    expect(end.usage).toEqual({ model: 'claude-opus-5', input: 10, output: 7, cacheRead: 2, cacheWrite: 0, costUsd: (10 * 5 + 7 * 25 + 2 * 0.5) / 1e6 });
  });
  it('reports unparseable tool input and excludes it from toolUses', async () => {
    const out = await collect([start(), toolStart(0), jsonDelta(0, '{"q":'), stop(0), msgDelta('max_tokens'), msgStop]);
    const end = out.find((e) => e.type === 'tool_use_end');
    expect(end && end.type === 'tool_use_end' && end.parseError).toBeTruthy();
    const last = out[out.length - 1]!;
    expect(last.type === 'message_end' && last.toolUses).toEqual([]);
    expect(last.type === 'message_end' && last.stopReason).toBe('max_tokens');
  });
  it('treats empty tool input as {} and closes out a stream that ends without message_stop', async () => {
    const out = await collect([start(), toolStart(0), stop(0), msgDelta('tool_use')]);
    expect(out[1]).toEqual({ type: 'tool_use_end', id: 't1', name: 'lookup', input: {} });
    expect(out[2]?.type).toBe('message_end');
  });
  it('surfaces iterator failures as an error event', async () => {
    async function* broken(): AsyncIterable<Ev> { await Promise.resolve(); yield start(); throw new Error('socket closed'); }
    const out: ModelEvent[] = [];
    for await (const e of normalizeStream(broken(), { model: 'claude-opus-5', catalog: createCatalog() })) out.push(e);
    expect(out[0]?.type).toBe('error');
  });
});
