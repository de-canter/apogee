import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isListEnvelope, type Envelope, type ListEnvelope } from '@de_canter/apogee-chat-kit';
import { EnvelopeProvider, httpTransport, mcpAppTransport, useAction, useEnvelope, type EnvelopeTransport } from '../react';
import { createFragment } from '../fragment';
import { makeHost, ticketEnvelope, ticketListEnvelope } from './harness';

type View = { title: string };
const NONE = { capability: 'noop', title: 'None', args: {} };

function TicketCard() {
  const { envelope, status, error } = useEnvelope<View>();
  const primary = envelope?.allowed_next_actions[0];
  const action = useAction(primary ?? NONE);
  if (!envelope) return <p>Loading</p>;
  if (isListEnvelope(envelope)) {
    return (
      <ul data-count={envelope.items.length}>
        {envelope.items.map((i) => <li key={i.id} data-state={i.state}>{i.data.title}</li>)}
        <li>{status}{error ? `:${error.code}` : ''}</li>
      </ul>
    );
  }
  return (
    <article data-state={envelope.state}>
      <h2>{envelope.data.title}</h2>
      <p>{status}{error ? `:${error.code}` : ''}</p>
      {primary ? <button onClick={() => void action.run({ assignee: 'bob' })} disabled={action.pending}>{primary.title}</button> : null}
    </article>
  );
}

const click = async (name: string, root: { getByRole: (role: 'button', opts: { name: string }) => HTMLElement } = screen): Promise<void> => {
  // The click fires a fire-and-forget async act(); the callback must itself be async (not
  // just awaited) so React's act() drains the resulting microtask-queued state update.
  await act(async () => { root.getByRole('button', { name }).click(); await Promise.resolve(); });
};

/** A transport whose call promise stays open until release(). */
function heldTransport() {
  let release: (e: Envelope) => void = () => undefined;
  const call = vi.fn(() => new Promise<Envelope | ListEnvelope>((r) => { release = r; }));
  const transport: EnvelopeTransport = { call };
  return { transport, call, release: (e: Envelope) => release(e) };
}

async function mcpHost(result: { content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown> }) {
  const host = makeHost();
  host.bridge.oncalltool = () => Promise.resolve(result);
  await host.connect();
  const fragment = createFragment({ name: 'x', version: '0', render: () => undefined });
  // Built BEFORE connect(), as the README says: it must not miss the one-shot initial tool result.
  const transport = mcpAppTransport(fragment.app);
  await fragment.connect(host.appEnd);
  return { host, fragment, transport };
}

describe('EnvelopeProvider', () => {
  it('renders from the initial envelope and acts through the transport', async () => {
    const call = vi.fn(() => Promise.resolve(ticketEnvelope('triaged')));
    const transport: EnvelopeTransport = { call };
    render(<EnvelopeProvider transport={transport} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>);
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'open');
    await click('Triage');
    expect(call).toHaveBeenCalledWith('ticket_triage', { id: 't1', assignee: 'bob' });
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'triaged');
  });

  it('surfaces transport errors without losing the envelope', async () => {
    const transport: EnvelopeTransport = { call: () => { throw Object.assign(new Error('No'), { code: 'ENTITLEMENT' }); } };
    render(<EnvelopeProvider transport={transport} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>);
    await click('Triage');
    expect(screen.getByText('error:ENTITLEMENT')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'open');
  });

  it.each([
    ['an Error without a code', new Error('boom'), 'error:INTERNAL'],
    ['an error-shaped object', { code: 'FORBIDDEN', message: 'no', allowed_next_actions: [NONE] }, 'error:FORBIDDEN'],
    ['a bare string', 'offline', 'error:INTERNAL'],
  ])('normalizes %s thrown by the transport', async (_label, thrown, text) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- non-Error rejections are the point of this case
    const transport: EnvelopeTransport = { call: () => Promise.reject(thrown) };
    render(<EnvelopeProvider transport={transport} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>);
    await click('Triage');
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('useAction.pending is true while the transport promise is held open', async () => {
    const t = heldTransport();
    render(<EnvelopeProvider transport={t.transport} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>);
    await click('Triage');
    expect(screen.getByRole('button', { name: 'Triage' })).toBeDisabled();
    expect(screen.getByText('acting')).toBeInTheDocument();
    await act(async () => { t.release(ticketEnvelope('triaged')); await Promise.resolve(); });
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'triaged');
  });

  it('ignores a second act while one is pending', async () => {
    const t = heldTransport();
    let captured: ReturnType<typeof useEnvelope> | null = null;
    function Grab() { captured = useEnvelope(); return null; }
    render(<EnvelopeProvider transport={t.transport} initial={ticketEnvelope()}><Grab /></EnvelopeProvider>);
    const a = ticketEnvelope().allowed_next_actions[0]!;
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = captured!.act(a);
      await captured!.act(a);
    });
    expect(t.call).toHaveBeenCalledTimes(1);
    await act(async () => { t.release(ticketEnvelope('triaged')); await first; });
    expect(t.call).toHaveBeenCalledTimes(1);
  });

  it('act stores a list result', async () => {
    const transport: EnvelopeTransport = { call: () => Promise.resolve(ticketListEnvelope()) };
    render(<EnvelopeProvider transport={transport} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>);
    await click('Triage');
    expect(screen.getByRole('list')).toHaveAttribute('data-count', '2');
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('useEnvelope outside a provider throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<TicketCard />)).toThrow(/EnvelopeProvider/);
    spy.mockRestore();
  });
});

describe('httpTransport', () => {
  it('parses envelopes and normalizes error bodies', async () => {
    const ok = httpTransport(() => Promise.resolve(ticketEnvelope('closed')));
    expect(((await ok.call('ticket_get', { id: 't1' })) as Envelope).state).toBe('closed');
    const bad = httpTransport(() => Promise.resolve({ error: { code: 'NOT_FOUND', message: 'gone' } }));
    await expect(bad.call('ticket_get', { id: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'gone' });
    const thrown = httpTransport(() => { throw new Error('offline'); });
    await expect(thrown.call('ticket_get', { id: 'x' })).rejects.toMatchObject({ code: 'INTERNAL', message: 'offline' });
    const allowed = httpTransport(() => Promise.reject(Object.assign(new Error('no'), { code: 'ILLEGAL_TRANSITION', allowed_next_actions: [NONE] })));
    await expect(allowed.call('ticket_triage', { id: 'x' })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION', allowed_next_actions: [NONE] });
  });

  it('resolves a valid list envelope', async () => {
    const list = httpTransport(() => Promise.resolve(ticketListEnvelope()));
    const result = await list.call('ticket_list', {});
    expect(isListEnvelope(result)).toBe(true);
  });

  it('rejects a body that is not an envelope with INVALID_INPUT', async () => {
    await expect(httpTransport(() => Promise.resolve({ weather: 'sunny' })).call('ticket_get', { id: 't1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(httpTransport(() => Promise.resolve(null)).call('ticket_get', { id: 't1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('mcpAppTransport', () => {
  const TRIAGED_TEXT = 'Ticket t1 is triaged and assigned to bob.';

  it('replays the initial tool result that arrived before the provider mounted', async () => {
    const { host, transport } = await mcpHost({ content: [], structuredContent: {} });
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() });
    await new Promise((r) => setTimeout(r, 20));
    render(<EnvelopeProvider transport={transport}><TicketCard /></EnvelopeProvider>);
    await vi.waitFor(() => expect(screen.getByRole('article')).toHaveAttribute('data-state', 'open'));
    expect(screen.getByRole('heading')).toHaveTextContent('Leak');
  });

  it('a pushed list tool result renders under the provider', async () => {
    const { host, transport } = await mcpHost({ content: [], structuredContent: {} });
    render(<EnvelopeProvider transport={transport}><TicketCard /></EnvelopeProvider>);
    await act(async () => { await host.bridge.sendToolResult({ content: [], structuredContent: ticketListEnvelope() }); });
    await vi.waitFor(() => expect(screen.getByRole('list')).toHaveAttribute('data-count', '2'));
    expect(screen.getByText('Drip')).toBeInTheDocument();
  });

  it('a pushed isError result sets the error without dropping the envelope', async () => {
    const { host, transport } = await mcpHost({ content: [], structuredContent: {} });
    render(<EnvelopeProvider transport={transport}><TicketCard /></EnvelopeProvider>);
    await act(async () => { await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() }); });
    await vi.waitFor(() => expect(screen.getByRole('article')).toHaveAttribute('data-state', 'open'));
    await act(async () => { await host.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: 'x' }], structuredContent: { error: { code: 'ENTITLEMENT', message: 'Out of scans' } } }); });
    await vi.waitFor(() => expect(screen.getByText('error:ENTITLEMENT')).toBeInTheDocument());
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'open');
  });

  it('replays a pushed error to a late subscriber, and an unsubscribed provider hears nothing more', async () => {
    const { host, transport } = await mcpHost({ content: [], structuredContent: {} });
    await host.bridge.sendToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    await new Promise((r) => setTimeout(r, 20));
    const onEnvelope = vi.fn();
    const onError = vi.fn();
    const unsubscribe = transport.subscribe!(onEnvelope, onError);
    expect(onError).toHaveBeenCalledWith({ code: 'INTERNAL', message: 'boom' });
    unsubscribe();
    await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() });
    await new Promise((r) => setTimeout(r, 20));
    expect(onEnvelope).not.toHaveBeenCalled();
  });

  it('call rejects an isError result with the code and allowed actions', async () => {
    const host = makeHost();
    host.bridge.oncalltool = () => Promise.resolve({ isError: true, content: [{ type: 'text', text: 'no' }], structuredContent: { error: { code: 'ILLEGAL_TRANSITION', message: 'no', allowed_next_actions: [NONE] } } });
    await host.connect();
    const fragment = createFragment({ name: 'x', version: '0', render: () => undefined });
    const transport = mcpAppTransport(fragment.app);
    await fragment.connect(host.appEnd);
    await expect(transport.call('ticket_triage', { id: 't1' })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION', allowed_next_actions: [NONE] });
  });

  it('the same card renders identically under the MCP transport and the HTTP transport, and afterAct sends the server text', async () => {
    const { host, transport } = await mcpHost({ content: [{ type: 'text', text: TRIAGED_TEXT }], structuredContent: ticketEnvelope('triaged') as unknown as Record<string, unknown> });
    // Each render gets its own detached container so `mcp`'s and `http`'s bound queries
    // (which testing-library scopes to `baseElement`, not just `container`) don't see each
    // other's DOM once both cards are mounted side by side.
    const mcp = render(<EnvelopeProvider transport={transport}><TicketCard /></EnvelopeProvider>, { container: document.createElement('div') });
    await act(async () => { await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() }); });
    await vi.waitFor(() => expect(mcp.container.querySelector('article')).not.toBeNull());
    const http = render(<EnvelopeProvider transport={httpTransport(() => Promise.resolve(ticketEnvelope()))} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>, { container: document.createElement('div') });
    expect(mcp.container.innerHTML).toBe(http.container.innerHTML);
    await click('Triage', mcp);
    await vi.waitFor(() => expect(mcp.container.querySelector('article')).toHaveAttribute('data-state', 'triaged'));
    await vi.waitFor(() => expect(host.contextUpdates).toHaveLength(1));
    const update = host.contextUpdates[0] as { content: Array<{ text: string }> };
    expect(update.content[0]!.text).toBe(TRIAGED_TEXT);
    // A provider remounted on the same transport replays the acted state, not the initial push.
    mcp.unmount();
    const again = render(<EnvelopeProvider transport={transport}><TicketCard /></EnvelopeProvider>, { container: document.createElement('div') });
    await vi.waitFor(() => expect(again.container.querySelector('article')).toHaveAttribute('data-state', 'triaged'));
  });

  it('afterAct falls back to describeEnvelope for an envelope it did not produce', async () => {
    const { host, transport } = await mcpHost({ content: [], structuredContent: {} });
    await transport.afterAct!(ticketEnvelope('closed'));
    await vi.waitFor(() => expect(host.contextUpdates).toHaveLength(1));
    const update = host.contextUpdates[0] as { content: Array<{ text: string }> };
    expect(JSON.parse(update.content[0]!.text)).toMatchObject({ state: 'closed' });
  });
});
