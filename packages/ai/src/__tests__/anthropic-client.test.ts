import { RateLimitError } from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { RefusalError, StructuredOutputError } from '../errors';
import { createAnthropicModelClient, type AnthropicLike } from '../anthropic-client';

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 };
const message = (over: Partial<Anthropic.Message> = {}): Anthropic.Message => ({
  id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
  content: [{ type: 'text', text: 'hello', citations: null }],
  usage: { ...usage, cache_creation: null, server_tool_use: null, service_tier: null, inference_geo: null, iterations: null, speed: null },
  ...over,
} as unknown as Anthropic.Message);

function fakeSdk(responses: Array<Anthropic.Message | Error>, streamEvents: Anthropic.MessageStreamEvent[] = []) {
  const calls: Anthropic.MessageCreateParams[] = [];
  const sdk: AnthropicLike = {
    messages: {
      create: vi.fn((params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
        calls.push(params);
        const next = responses.shift();
        if (next instanceof Error) return Promise.reject(next);
        if (!next) return Promise.reject(new Error('no scripted response'));
        return Promise.resolve(next);
      }),
      stream: vi.fn((params: Anthropic.MessageCreateParams) => {
        calls.push(params);
        return (async function* () { for (const e of streamEvents) { await Promise.resolve(); yield e; } })();
      }),
    },
  };
  return { sdk, calls };
}

describe('createAnthropicModelClient', () => {
  it('generate resolves roles, extracts text and tool uses, prices usage, records the ledger', async () => {
    const { sdk, calls } = fakeSdk([
      message({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'hello', citations: null }, { type: 'tool_use', id: 't1', name: 'lookup', input: { q: 1 } }] as unknown as Anthropic.ContentBlock[] }),
      message(),
    ]);
    const client = createAnthropicModelClient({ sdk });
    const r = await client.generate({ messages: [{ role: 'user', content: 'hi' }] }, { label: 'test' });
    expect(r.text).toBe('hello');
    expect(r.toolUses).toEqual([{ id: 't1', name: 'lookup', input: { q: 1 } }]);
    expect(r.stopReason).toBe('tool_use');
    expect(r.usage.costUsd).toBeCloseTo((10 * 5 + 5 * 25 + 3 * 0.5) / 1e6, 12);
    expect(calls[0]?.model).toBe('claude-opus-5');
    await client.generate({ model: 'fast', messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[1]?.model).toBe('claude-haiku-4-5');
    expect(client.usage.records().map((x) => [x.operation, x.role, x.label])).toEqual([['generate', 'default', 'test'], ['generate', 'fast', undefined]]);
  });
  it('generateObject sends a json_schema output format, validates, and reports schema failures with raw text', async () => {
    const { sdk, calls } = fakeSdk([
      message({ content: [{ type: 'text', text: '{"name":"Jane"}', citations: null }] }),
      message({ content: [{ type: 'text', text: '{"name":5}', citations: null }] }),
      message({ content: [{ type: 'text', text: 'not json', citations: null }] }),
    ]);
    const client = createAnthropicModelClient({ sdk });
    const schema = z.object({ name: z.string() });
    const r = await client.generateObject(schema, { messages: [{ role: 'user', content: 'extract' }] });
    expect(r.value).toEqual({ name: 'Jane' });
    const format = (calls[0] as unknown as { output_config: { format: { type: string; schema: Record<string, unknown> } } }).output_config.format;
    expect(format.type).toBe('json_schema');
    expect(format.schema['type']).toBe('object');
    expect(calls[0]?.max_tokens).toBe(4096);
    await expect(client.generateObject(schema, { messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ rawText: '{"name":5}' });
    await expect(client.generateObject(schema, { messages: [{ role: 'user', content: 'x' }] })).rejects.toBeInstanceOf(StructuredOutputError);
    expect(client.usage.total().calls).toBe(3);
  });
  it('maps refusal stop reasons to RefusalError', async () => {
    const { sdk } = fakeSdk([message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'no' } })]);
    const client = createAnthropicModelClient({ sdk });
    await expect(client.generate({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ category: 'cyber' });
    await expect(client.generate({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow();
    expect(new RefusalError('cyber')).toBeInstanceOf(RefusalError);
  });
  it('retries retryable errors with backoff and gives up after maxRetries', async () => {
    const rl = () => new RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } }, 'slow', new Headers());
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => { sleeps.push(ms); return Promise.resolve(); };
    const { sdk } = fakeSdk([rl(), message()]);
    const client = createAnthropicModelClient({ sdk, sleep });
    const r = await client.generate({ messages: [{ role: 'user', content: 'x' }] });
    expect(r.text).toBe('hello');
    expect(sleeps).toEqual([500]);
    const { sdk: sdk2 } = fakeSdk([rl(), rl(), rl()]);
    await expect(createAnthropicModelClient({ sdk: sdk2, sleep, maxRetries: 2 }).generate({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(sleeps).toEqual([500, 500, 1000]);
  });
  it('stream normalizes events and records usage', async () => {
    const events = [
      { type: 'message_start', message: message({ content: [] }) },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'yo' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ] as unknown as Anthropic.MessageStreamEvent[];
    const { sdk, calls } = fakeSdk([], events);
    const client = createAnthropicModelClient({ sdk });
    const out = [];
    for await (const e of client.stream({ messages: [{ role: 'user', content: 'x' }], tools: [{ name: 't', description: 'd', inputSchema: { type: 'object', properties: {} } }] })) out.push(e);
    expect(out.map((e) => e.type)).toEqual(['text_delta', 'message_end']);
    expect(calls[0]?.max_tokens).toBe(64000);
    expect((calls[0]?.tools?.[0] as unknown as Record<string, unknown>)['eager_input_streaming']).toBe(true);
    expect(client.usage.records()[0]?.operation).toBe('stream');
  });
});
