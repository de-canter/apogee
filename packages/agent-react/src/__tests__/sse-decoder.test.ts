import { encodeAgentEvent, type AgentEvent } from '@de_canter/apogee-agent';
import { describe, expect, it } from 'vitest';
import { decodeSseStream } from '../sse-decoder';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
}
async function all(s: ReadableStream<Uint8Array>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of decodeSseStream(s)) out.push(e);
  return out;
}

describe('decodeSseStream', () => {
  it('reassembles frames split across chunks and ignores comments/blank lines', async () => {
    const a = encodeAgentEvent({ type: 'text_delta', text: 'hello' });
    const b = encodeAgentEvent({ type: 'tool_call', toolUseId: 't', name: 'n', input: { q: 1 } });
    const mid = Math.floor(a.length / 2);
    const events = await all(streamOf([': keepalive\n\n', a.slice(0, mid), a.slice(mid) + b.slice(0, 10), b.slice(10)]));
    expect(events).toEqual([{ type: 'text_delta', text: 'hello' }, { type: 'tool_call', toolUseId: 't', name: 'n', input: { q: 1 } }]);
  });
  it('yields a BAD_FRAME error for malformed JSON and continues', async () => {
    const events = await all(streamOf(['data: {not json\n\n', encodeAgentEvent({ type: 'text_delta', text: 'ok' })]));
    expect(events[0]?.type).toBe('error');
    expect(events[0]?.type === 'error' && events[0].error.code).toBe('BAD_FRAME');
    expect(events[1]).toEqual({ type: 'text_delta', text: 'ok' });
  });
  it('flushes a trailing frame without a terminating blank line', async () => {
    const events = await all(streamOf(['data: {"type":"text_delta","text":"tail"}']));
    expect(events).toEqual([{ type: 'text_delta', text: 'tail' }]);
  });
});
