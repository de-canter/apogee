import type { AgentEvent } from './events';

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

/** One SSE frame per event: `data: <json>\n\n`. */
export function encodeAgentEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function errorEvent(e: unknown): AgentEvent {
  const code = typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : 'STREAM';
  return { type: 'error', error: { code, message: e instanceof Error ? e.message : String(e) } };
}

/** Web-standard body for `new Response(stream, { headers: SSE_HEADERS })` (Next.js route handlers, Workers). */
export function agentEventsToReadableStream(events: AsyncIterable<AgentEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]() as AsyncIterator<AgentEvent, void, undefined>;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeAgentEvent(value)));
      } catch (e) {
        controller.enqueue(encoder.encode(encodeAgentEvent(errorEvent(e))));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** Minimal Node response surface (Fastify `reply.raw`, Express `res`). */
export interface NodeResponseLike {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(): unknown;
}

export async function pipeAgentEventsToNode(events: AsyncIterable<AgentEvent>, res: NodeResponseLike, extraHeaders: Record<string, string> = {}): Promise<void> {
  res.writeHead(200, { ...SSE_HEADERS, ...extraHeaders });
  try {
    for await (const e of events) res.write(encodeAgentEvent(e));
  } catch (e) {
    res.write(encodeAgentEvent(errorEvent(e)));
  } finally {
    res.end();
  }
}
