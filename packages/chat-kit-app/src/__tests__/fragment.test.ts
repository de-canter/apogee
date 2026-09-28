import { describe, expect, it, vi } from 'vitest';
import { createFragment, type FragmentContext } from '../fragment';
import { makeHost, ticketEnvelope } from './harness';

async function setup() {
  const host = makeHost({ theme: 'dark' });
  const renders: FragmentContext<{ title: string }>[] = [];
  const fragment = createFragment<{ title: string }>({ name: 'ticket-card', version: '0.0.0', render: (c) => { renders.push({ ...c }); } });
  host.bridge.oncalltool = (p) => {
    host.calls.push({ name: p.name, arguments: p.arguments });
    if (p.name === 'ticket_triage') return Promise.resolve({ content: [], structuredContent: ticketEnvelope('triaged') as unknown as Record<string, unknown> });
    return Promise.resolve({ isError: true, content: [{ type: 'text', text: 'x' }], structuredContent: { error: { code: 'ILLEGAL_TRANSITION', message: 'no', allowed_next_actions: [] } } });
  };
  await host.connect();
  await fragment.connect(host.appEnd);
  return { host, renders, fragment };
}

const last = <T,>(xs: T[]): T => xs[xs.length - 1]!;

describe('createFragment', () => {
  it('renders the envelope from a tool result and exposes host context', async () => {
    const { host, renders } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() });
    await vi.waitFor(() => expect(last(renders).envelope?.state).toBe('open'));
    expect(last(renders).host?.theme).toBe('dark');
    expect(last(renders).status).toBe('idle');
  });

  it('act calls the tool, re-renders, and updates model context', async () => {
    const { host, renders } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() });
    await vi.waitFor(() => expect(last(renders).envelope).not.toBeNull());
    await last(renders).act(last(renders).envelope!.allowed_next_actions[0]!, { assignee: 'bob' });
    expect(host.calls).toEqual([{ name: 'ticket_triage', arguments: { id: 't1', assignee: 'bob' } }]);
    expect(renders.some((r) => r.status === 'acting')).toBe(true);
    expect(last(renders)).toMatchObject({ status: 'idle', envelope: { state: 'triaged' } });
    await vi.waitFor(() => expect(host.contextUpdates).toHaveLength(1));
    expect(host.contextUpdates[0]).toMatchObject({ structuredContent: { state: 'triaged' }, content: [{ type: 'text' }] });
  });

  it('an error result sets status error with the allowed actions, and does not replace the envelope', async () => {
    const { host, renders } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope('triaged') });
    await vi.waitFor(() => expect(last(renders).envelope?.state).toBe('triaged'));
    await last(renders).act({ capability: 'ticket_close', title: 'Close', args: { id: 't1' } });
    expect(last(renders)).toMatchObject({ status: 'error', error: { code: 'ILLEGAL_TRANSITION' }, envelope: { state: 'triaged' } });
  });

  it('a non-envelope tool result is an error, not a throw', async () => {
    const { host, renders } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: { weather: 'sunny' } });
    await vi.waitFor(() => expect(last(renders).status).toBe('error'));
    expect(last(renders).error?.code).toBe('INVALID_INPUT');
  });

  it('ignores a second act while one is pending', async () => {
    const { host, renders } = await setup();
    let release!: () => void;
    host.bridge.oncalltool = async () => { await new Promise<void>((r) => { release = r; }); return { content: [], structuredContent: ticketEnvelope('triaged') as unknown as Record<string, unknown> }; };
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() });
    await vi.waitFor(() => expect(last(renders).envelope).not.toBeNull());
    const a = last(renders).envelope!.allowed_next_actions[0]!;
    const first = last(renders).act(a);
    await last(renders).act(a);
    release();
    await first;
    expect(renders.filter((r) => r.status === 'acting')).toHaveLength(1);
  });

  it('ask sends a user message and host context changes re-apply the theme', async () => {
    const { host, renders } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() });
    await vi.waitFor(() => expect(last(renders).envelope).not.toBeNull());
    await last(renders).ask('Tell me more');
    expect(host.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Tell me more' }] });
    await host.bridge.sendHostContextChange({ theme: 'light' });
    await vi.waitFor(() => expect(last(renders).host?.theme).toBe('light'));
  });

  it('destroy() tears down the handlers and closes the connection; a second destroy() is a no-op', async () => {
    const { host, renders, fragment } = await setup();
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() });
    await vi.waitFor(() => expect(last(renders).envelope).not.toBeNull());
    // Let the SDK's initial size-changed notification (scheduled via requestAnimationFrame at
    // connect time) settle while the transport is still open, so destroy() below doesn't race it.
    await new Promise((r) => setTimeout(r, 20));
    const renderCount = renders.length;

    fragment.destroy();
    expect(() => fragment.destroy()).not.toThrow();

    try {
      await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope('triaged') });
    } catch {
      // Expected once the underlying transport is closed.
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(renders).toHaveLength(renderCount);
  });
});
