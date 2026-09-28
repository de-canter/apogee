import { describe, expect, it, vi } from 'vitest';
import { describeEnvelope, isListEnvelope } from '@de_canter/apogee-chat-kit';
import { createFragment, type FragmentContext } from '../fragment';
import { makeHost, ticketEnvelope, ticketListEnvelope } from './harness';

type Host = ReturnType<typeof makeHost>;
type CallHandler = NonNullable<Host['bridge']['oncalltool']>;
type CallParams = Parameters<CallHandler>[0];
type CallResult = Awaited<ReturnType<CallHandler>>;

const TRIAGED_TEXT = 'Ticket t1 is triaged and assigned to bob.';

const defaultCall = (p: CallParams): Promise<CallResult> => {
  if (p.name === 'ticket_triage') {
    return Promise.resolve({ content: [{ type: 'text', text: TRIAGED_TEXT }], structuredContent: ticketEnvelope('triaged') as unknown as Record<string, unknown> });
  }
  return Promise.resolve({ isError: true, content: [{ type: 'text', text: 'x' }], structuredContent: { error: { code: 'ILLEGAL_TRANSITION', message: 'no', allowed_next_actions: [] } } });
};

async function setup(render?: (c: FragmentContext<{ title: string }>) => void) {
  const host = makeHost({ theme: 'dark' });
  const renders: FragmentContext<{ title: string }>[] = [];
  const fragment = createFragment<{ title: string }>({
    name: 'ticket-card', version: '0.0.0',
    render: (c) => { renders.push({ ...c }); render?.(c); },
  });
  // One oncalltool handler for the whole test (replacing it prints an SDK warning); tests swap
  // behavior through this indirection instead.
  let handleCall: (p: CallParams) => Promise<CallResult> = defaultCall;
  host.bridge.oncalltool = (p) => {
    host.calls.push({ name: p.name, arguments: p.arguments });
    return handleCall(p);
  };
  await host.connect();
  await fragment.connect(host.appEnd);
  return { host, renders, fragment, onCall: (h: (p: CallParams) => Promise<CallResult>) => { handleCall = h; } };
}

const last = <T,>(xs: T[]): T => xs[xs.length - 1]!;
const stateOf = (c: FragmentContext<{ title: string }>): string | undefined =>
  c.envelope && !isListEnvelope(c.envelope) ? c.envelope.state : undefined;

async function withEnvelope(host: Host, renders: FragmentContext<{ title: string }>[], state = 'open') {
  await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope(state) });
  await vi.waitFor(() => expect(stateOf(last(renders))).toBe(state));
}

const held = (): { handler: () => Promise<CallResult>; release: () => void } => {
  let release: () => void = () => undefined;
  const handler = async (): Promise<CallResult> => {
    await new Promise<void>((r) => { release = r; });
    return { content: [], structuredContent: ticketEnvelope('triaged') as unknown as Record<string, unknown> };
  };
  return { handler, release: () => release() };
};

describe('createFragment', () => {
  it('renders the envelope from a tool result and exposes host context', async () => {
    const { host, renders } = await setup();
    await withEnvelope(host, renders);
    expect(last(renders).host?.theme).toBe('dark');
    expect(last(renders).status).toBe('idle');
  });

  it('renders a list envelope from a tool result', async () => {
    const { host, renders } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketListEnvelope() });
    await vi.waitFor(() => expect(last(renders).envelope).not.toBeNull());
    const env = last(renders).envelope!;
    expect(isListEnvelope(env) && env.items.map((i) => i.id)).toEqual(['t1', 't2']);
  });

  it('act calls the tool, re-renders, and hands the model the server text', async () => {
    const { host, renders } = await setup();
    await withEnvelope(host, renders);
    await last(renders).act(last(renders).envelope!.allowed_next_actions[0]!, { assignee: 'bob' });
    expect(host.calls).toEqual([{ name: 'ticket_triage', arguments: { id: 't1', assignee: 'bob' } }]);
    expect(renders.some((r) => r.status === 'acting')).toBe(true);
    expect(last(renders).status).toBe('idle');
    expect(stateOf(last(renders))).toBe('triaged');
    await vi.waitFor(() => expect(host.contextUpdates).toHaveLength(1));
    const update = host.contextUpdates[0] as { content: Array<{ type: string; text: string }>; structuredContent: unknown };
    expect(update.content[0]!.text).toBe(TRIAGED_TEXT);
    expect(update.structuredContent).toMatchObject({ state: 'triaged' });
  });

  it('act falls back to describeEnvelope when the result has no text block', async () => {
    const { host, renders, onCall } = await setup();
    const triaged = ticketEnvelope('triaged');
    onCall(() => Promise.resolve({ content: [], structuredContent: triaged as unknown as Record<string, unknown> }));
    await withEnvelope(host, renders);
    await last(renders).act(last(renders).envelope!.allowed_next_actions[0]!);
    await vi.waitFor(() => expect(host.contextUpdates).toHaveLength(1));
    const update = host.contextUpdates[0] as { content: Array<{ text: string }> };
    expect(update.content[0]!.text).toBe(describeEnvelope(triaged));
  });

  it('an error result sets status error with the allowed actions, and does not replace the envelope', async () => {
    const { host, renders } = await setup();
    await withEnvelope(host, renders, 'triaged');
    await last(renders).act({ capability: 'ticket_close', title: 'Close', args: { id: 't1' } });
    expect(last(renders)).toMatchObject({ status: 'error', error: { code: 'ILLEGAL_TRANSITION' } });
    expect(stateOf(last(renders))).toBe('triaged');
  });

  it('a host that rejects tools/call leaves status error INTERNAL, keeps the envelope, and the next act goes through', async () => {
    const { host, renders, onCall } = await setup();
    await withEnvelope(host, renders);
    onCall(() => Promise.reject(new Error('host exploded')));
    const a = last(renders).envelope!.allowed_next_actions[0]!;
    await last(renders).act(a, { assignee: 'bob' });
    expect(last(renders)).toMatchObject({ status: 'error', error: { code: 'INTERNAL' } });
    expect(stateOf(last(renders))).toBe('open');
    onCall(defaultCall);
    await last(renders).act(a, { assignee: 'bob' });
    expect(last(renders)).toMatchObject({ status: 'idle', error: null });
    expect(stateOf(last(renders))).toBe('triaged');
    expect(host.calls).toHaveLength(2);
  });

  it('a non-envelope tool result is an error, not a throw', async () => {
    const { host, renders } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: { weather: 'sunny' } });
    await vi.waitFor(() => expect(last(renders).status).toBe('error'));
    expect(last(renders).error?.code).toBe('INVALID_INPUT');
  });

  it('ignores a second act while one is pending', async () => {
    const { host, renders, onCall } = await setup();
    const h = held();
    onCall(h.handler);
    await withEnvelope(host, renders);
    const a = last(renders).envelope!.allowed_next_actions[0]!;
    const first = last(renders).act(a);
    await last(renders).act(a);
    await vi.waitFor(() => expect(host.calls).toHaveLength(1));
    h.release();
    await first;
    expect(renders.filter((r) => r.status === 'acting')).toHaveLength(1);
    expect(host.calls.length).toBe(1);
  });

  it('a throwing render never escapes act: it becomes status error INTERNAL', async () => {
    const { host, renders } = await setup((c) => {
      if (c.status === 'idle' && stateOf(c) === 'triaged') throw new Error('render bug');
    });
    await withEnvelope(host, renders);
    await expect(last(renders).act(last(renders).envelope!.allowed_next_actions[0]!, { assignee: 'bob' })).resolves.toBeUndefined();
    expect(last(renders)).toMatchObject({ status: 'error', error: { code: 'INTERNAL', message: 'render bug' } });
  });

  it('a render that throws even for the error state is swallowed', async () => {
    const { host, renders } = await setup((c) => { if (stateOf(c) === 'triaged') throw new Error('always'); });
    await withEnvelope(host, renders);
    await expect(last(renders).act(last(renders).envelope!.allowed_next_actions[0]!)).resolves.toBeUndefined();
    expect(last(renders).status).toBe('error');
  });

  it('ask sends a user message, openLink forwards the url, and host context changes re-apply the theme', async () => {
    const { host, renders } = await setup();
    await withEnvelope(host, renders);
    await last(renders).ask('Tell me more');
    expect(host.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Tell me more' }] });
    await last(renders).openLink('https://example.com/t1');
    expect(host.links).toEqual([{ url: 'https://example.com/t1' }]);
    await host.bridge.sendHostContextChange({ theme: 'light' });
    await vi.waitFor(() => expect(last(renders).host?.theme).toBe('light'));
  });

  it('destroy() tears down the handlers and closes the connection; a second destroy() is a no-op', async () => {
    const { host, renders, fragment } = await setup();
    await withEnvelope(host, renders);
    // Let the SDK's initial size-changed notification (scheduled via requestAnimationFrame at
    // connect time) settle while the transport is still open, so destroy() below doesn't race it.
    await new Promise((r) => setTimeout(r, 20));
    const renderCount = renders.length;
    const ctx = last(renders);

    fragment.destroy();
    expect(() => fragment.destroy()).not.toThrow();
    await ctx.act({ capability: 'ticket_triage', title: 'Triage', args: { id: 't1' } });
    expect(host.calls).toHaveLength(0);

    try {
      await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope('triaged') });
    } catch {
      // Expected once the underlying transport is closed.
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(renders).toHaveLength(renderCount);
  });

  it('an act in flight when the fragment is destroyed does not render its result', async () => {
    const { host, renders, fragment, onCall } = await setup();
    const h = held();
    onCall(h.handler);
    await withEnvelope(host, renders);
    await new Promise((r) => setTimeout(r, 20));
    const inFlight = last(renders).act(last(renders).envelope!.allowed_next_actions[0]!);
    await vi.waitFor(() => expect(host.calls).toHaveLength(1));
    const renderCount = renders.length;
    fragment.destroy();
    h.release();
    await inFlight;
    expect(renders).toHaveLength(renderCount);
  });

  it('host teardown destroys the fragment', async () => {
    const { host, renders } = await setup();
    await withEnvelope(host, renders);
    await new Promise((r) => setTimeout(r, 20));
    await expect(host.bridge.teardownResource({})).resolves.toEqual({});
    const renderCount = renders.length;
    try {
      await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope('triaged') });
    } catch {
      // Expected once the underlying transport is closed.
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(renders).toHaveLength(renderCount);
  });
});
