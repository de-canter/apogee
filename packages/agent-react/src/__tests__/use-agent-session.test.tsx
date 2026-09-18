import type { AgentEvent, AgentMessage } from '@apogee/agent';
import { isoDate } from '@apogee/kernel';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchSseTransport, useAgentSession, type SendInput } from '../use-agent-session';

const at = isoDate('2026-01-01');
const usage = { model: 'claude-opus-5', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
const final: AgentMessage = { id: 'a1', role: 'assistant', content: 'Hello!', artifacts: [{ type: 'card', id: 'c1', data: {} }], at };
async function* script(): AsyncIterable<AgentEvent> {
  await Promise.resolve();
  yield { type: 'text_delta', text: 'Hel' };
  yield { type: 'text_delta', text: 'lo!' };
  yield { type: 'turn_end', message: final, usage, rounds: 1, stopReason: 'end_turn' };
}

describe('useAgentSession', () => {
  it('sends, shows the streaming pseudo-message, then the final message with artifacts', async () => {
    const inputs: SendInput[] = [];
    const transport = vi.fn((input: SendInput) => { inputs.push(input); return Promise.resolve(script()); });
    const { result } = renderHook(() => useAgentSession({ transport }));
    let p: Promise<void> | undefined;
    act(() => { p = result.current.sendMessage('hi', { annotations: ['[x]'] }); });
    await waitFor(() => expect(result.current.state.isStreaming).toBe(true));
    await act(async () => { await p; });
    expect(inputs[0]).toEqual({ text: 'hi', annotations: ['[x]'] });
    expect(result.current.displayMessages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.current.displayMessages[1]?.artifacts).toHaveLength(1);
    expect(result.current.state.isStreaming).toBe(false);
    act(() => result.current.reset());
    expect(result.current.displayMessages).toEqual([]);
  });
  it('turns transport failures into an error state', async () => {
    const { result } = renderHook(() => useAgentSession({ transport: () => Promise.reject(new Error('offline')) }));
    await act(async () => { await result.current.sendMessage('hi'); });
    expect(result.current.state.error).toEqual({ code: 'TRANSPORT', message: 'offline' });
  });
});

describe('fetchSseTransport', () => {
  it('POSTs JSON and decodes the SSE body', async () => {
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"text_delta","text":"x"}\n\n')); c.close(); } });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(body, { status: 200 })));
    const transport = fetchSseTransport('/api/agent', { fetch: fetchMock as unknown as typeof fetch, headers: () => ({ Authorization: 'Bearer t' }) });
    const events = [];
    for await (const e of await transport({ text: 'hi', artifactAction: { artifactId: 'a', actionType: 'submit' } })) events.push(e);
    expect(events).toEqual([{ type: 'text_delta', text: 'x' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/agent');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer t' });
    expect(JSON.parse(init.body as string)).toEqual({ message: 'hi', annotations: [], artifactAction: { artifactId: 'a', actionType: 'submit' } });
    const bad = fetchSseTransport('/x', { fetch: (() => Promise.resolve(new Response(null, { status: 500 }))) as unknown as typeof fetch });
    await expect(bad({ text: 'hi' })).rejects.toThrow('500');
  });
});
