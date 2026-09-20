import type { AgentEvent } from '@de_canter/apogee-agent';

function parseFrame(frame: string): AgentEvent | undefined {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (data === '') return undefined;
  try {
    return JSON.parse(data) as AgentEvent;
  } catch (e) {
    return { type: 'error', error: { code: 'BAD_FRAME', message: e instanceof Error ? e.message : 'malformed frame' } };
  }
}

/** Decode an SSE body produced by `@de_canter/apogee-agent`'s encoder back into events. */
export async function* decodeSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseFrame(frame);
      if (ev) yield ev;
      idx = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() !== '') {
    const ev = parseFrame(buffer);
    if (ev) yield ev;
  }
}
