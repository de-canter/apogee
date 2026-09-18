import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiError, StructuredOutputError } from '../errors';
import { createFakeModelClient } from '../fake-client';

const req = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('createFakeModelClient', () => {
  it('replays generate turns and records calls and usage', async () => {
    const client = createFakeModelClient([
      { text: 'hello', usage: { input: 10, output: 2 } },
      { toolUses: [{ id: 't1', name: 'lookup', input: { q: 1 } }] },
    ]);
    const a = await client.generate(req, { label: 'a' });
    expect(a.text).toBe('hello');
    expect(a.stopReason).toBe('end_turn');
    expect(a.usage.costUsd).toBeCloseTo((10 * 5 + 2 * 25) / 1e6, 12);
    const b = await client.generate({ ...req, model: 'fast' });
    expect(b.stopReason).toBe('tool_use');
    expect(b.usage.model).toBe('claude-haiku-4-5');
    expect(client.calls).toHaveLength(2);
    expect(client.usage.records().map((r) => r.label)).toEqual(['a', undefined]);
    await expect(client.generate(req)).rejects.toMatchObject({ code: 'SCRIPT_EXHAUSTED' });
  });
  it('validates generateObject turns against the schema', async () => {
    const client = createFakeModelClient([{ object: { name: 'Jane' } }, { object: { name: 5 } }]);
    const schema = z.object({ name: z.string() });
    expect((await client.generateObject(schema, req)).value).toEqual({ name: 'Jane' });
    await expect(client.generateObject(schema, req)).rejects.toBeInstanceOf(StructuredOutputError);
  });
  it('streams text in chunks, then tool events, then message_end', async () => {
    const client = createFakeModelClient([{ text: 'hello world', toolUses: [{ id: 't1', name: 'lookup', input: { q: 1 } }] }]);
    const out = [];
    for await (const e of client.stream(req)) out.push(e);
    expect(out.map((e) => e.type)).toEqual(['text_delta', 'text_delta', 'text_delta', 'tool_use_start', 'tool_use_delta', 'tool_use_end', 'message_end']);
    expect(out[0]).toEqual({ type: 'text_delta', text: 'hello' });
    const end = out[6];
    expect(end?.type === 'message_end' && end.text).toBe('hello world');
    expect(client.usage.records()[0]?.operation).toBe('stream');
  });
  it('supports function scripts and error turns', async () => {
    const client = createFakeModelClient((r, i) => {
      const c = r.messages[0]?.content;
      return i === 0 ? { text: `echo:${typeof c === 'string' ? c : ''}` } : { error: new AiError('down', 'OVERLOADED', true) };
    });
    expect((await client.generate(req)).text).toBe('echo:hi');
    await expect(client.generate(req)).rejects.toMatchObject({ code: 'OVERLOADED' });
    const out = [];
    for await (const e of client.stream(req)) out.push(e);
    expect(out[0]?.type).toBe('error');
  });
});
