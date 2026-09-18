import { describe, expect, it } from 'vitest';
import { buildMessageParams } from '../params';

type Block = { text: string; cache_control?: unknown };

describe('buildMessageParams', () => {
  it('maps a minimal request with defaults', () => {
    const p = buildMessageParams({ messages: [{ role: 'user', content: 'hi' }] }, { model: 'claude-opus-5', streaming: false });
    expect(p.model).toBe('claude-opus-5');
    expect(p.max_tokens).toBe(16000);
    expect(p.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.system).toBeUndefined();
  });
  it('puts cache_control on the last system block and last tool, and eager streaming on tools when streaming', () => {
    const p = buildMessageParams({
      system: [{ text: 'stable' }, { text: 'also stable' }],
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} }, strict: true },
      ],
    }, { model: 'claude-opus-5', streaming: true });
    const system = p.system as Block[];
    expect(system[0]!.cache_control).toBeUndefined();
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral' });
    const tools = p.tools as unknown as Array<Record<string, unknown>>;
    expect(tools[0]!['cache_control']).toBeUndefined();
    expect(tools[1]!['cache_control']).toEqual({ type: 'ephemeral' });
    expect(tools[1]!['strict']).toBe(true);
    expect(tools[0]!['eager_input_streaming']).toBe(true);
    expect(p.max_tokens).toBe(64000);
  });
  it('honors an explicit cache boundary and cache:false', () => {
    const p = buildMessageParams({ system: [{ text: 'stable', cache: true }, { text: 'volatile' }], messages: [{ role: 'user', content: 'x' }] }, { model: 'claude-opus-5', streaming: false });
    const system = p.system as Block[];
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]!.cache_control).toBeUndefined();
    const q = buildMessageParams({ system: 'plain', messages: [{ role: 'user', content: 'x' }], cache: false }, { model: 'claude-opus-5', streaming: false });
    expect((q.system as Block[])[0]!.cache_control).toBeUndefined();
  });
  it('maps content blocks, effort, thinking off, stop sequences, metadata', () => {
    const p = buildMessageParams({
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } },
        { type: 'image', source: { type: 'url', url: 'https://x/y.png' } },
        { type: 'document', source: { type: 'base64', mediaType: 'application/pdf', data: 'BBBB' }, title: 'Deed' },
        { type: 'document', source: { type: 'text', mediaType: 'text/plain', data: 'plain' } },
        { type: 'text', text: 'Describe' },
      ] }],
      effort: 'low', thinking: false, stopSequences: ['END'], maxTokens: 500, metadata: { userId: 'u1' },
    }, { model: 'claude-haiku-4-5', streaming: false });
    const content = p.messages[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    expect(content[1]).toEqual({ type: 'image', source: { type: 'url', url: 'https://x/y.png' } });
    expect(content[2]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' }, title: 'Deed' });
    expect(content[3]).toEqual({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'plain' } });
    expect(content[4]).toEqual({ type: 'text', text: 'Describe' });
    expect(p.output_config).toEqual({ effort: 'low' });
    expect(p.thinking).toBeUndefined();
    expect(p.stop_sequences).toEqual(['END']);
    expect(p.max_tokens).toBe(500);
    expect(p.metadata).toEqual({ user_id: 'u1' });
  });
  it('maps tool_use and tool_result blocks for multi-round loops', () => {
    const p = buildMessageParams({ messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'Looking up.' }, { type: 'tool_use', id: 't1', name: 'lookup', input: { q: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: '{"ok":true}' }, { type: 'tool_result', toolUseId: 't2', content: 'Error: boom', isError: true }] },
    ] }, { model: 'claude-opus-5', streaming: false });
    const a = p.messages[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(a[1]).toEqual({ type: 'tool_use', id: 't1', name: 'lookup', input: { q: 1 } });
    const u = p.messages[1]!.content as unknown as Array<Record<string, unknown>>;
    expect(u[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' });
    expect(u[1]).toEqual({ type: 'tool_result', tool_use_id: 't2', content: 'Error: boom', is_error: true });
  });
});
