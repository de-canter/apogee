import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Envelope } from '@de_canter/apogee-chat-kit';
import { EnvelopeProvider, httpTransport, mcpAppTransport, useAction, useEnvelope, type EnvelopeTransport } from '../react';
import { createFragment } from '../fragment';
import { makeHost, ticketEnvelope } from './harness';

function TicketCard() {
  const { envelope, status, error } = useEnvelope<{ title: string }>();
  const primary = envelope?.allowed_next_actions[0];
  const action = useAction(primary ?? { capability: 'noop', title: 'None', args: {} });
  if (!envelope) return <p>Loading</p>;
  return (
    <article data-state={envelope.state}>
      <h2>{envelope.data.title}</h2>
      <p>{status}{error ? `:${error.code}` : ''}</p>
      {primary ? <button onClick={() => void action.run({ assignee: 'bob' })} disabled={action.pending}>{primary.title}</button> : null}
    </article>
  );
}

describe('EnvelopeProvider', () => {
  it('renders from the initial envelope and acts through the transport', async () => {
    const call = vi.fn(() => Promise.resolve(ticketEnvelope('triaged')));
    const transport: EnvelopeTransport = { call };
    render(<EnvelopeProvider transport={transport} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>);
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'open');
    // The click fires a fire-and-forget async act(); the callback must itself be async (not
    // just awaited) so React's act() drains the resulting microtask-queued state update.
    await act(async () => { screen.getByRole('button', { name: 'Triage' }).click(); await Promise.resolve(); });
    expect(call).toHaveBeenCalledWith('ticket_triage', { id: 't1', assignee: 'bob' });
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'triaged');
  });

  it('surfaces transport errors without losing the envelope', async () => {
    const transport: EnvelopeTransport = { call: () => { throw Object.assign(new Error('No'), { code: 'ENTITLEMENT' }); } };
    render(<EnvelopeProvider transport={transport} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>);
    await act(async () => { screen.getByRole('button', { name: 'Triage' }).click(); await Promise.resolve(); });
    expect(screen.getByText('error:ENTITLEMENT')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('data-state', 'open');
  });

  it('httpTransport parses envelopes and normalizes error bodies', async () => {
    const ok = httpTransport(() => Promise.resolve(ticketEnvelope('closed')));
    expect(((await ok.call('ticket_get', { id: 't1' })) as Envelope).state).toBe('closed');
    const bad = httpTransport(() => Promise.resolve({ error: { code: 'NOT_FOUND', message: 'gone' } }));
    await expect(bad.call('ticket_get', { id: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'gone' });
    const thrown = httpTransport(() => { throw new Error('offline'); });
    await expect(thrown.call('ticket_get', { id: 'x' })).rejects.toMatchObject({ code: 'INTERNAL', message: 'offline' });
  });

  it('the same card renders identically under the MCP transport and the HTTP transport', async () => {
    const host = makeHost();
    host.bridge.oncalltool = () => Promise.resolve({ content: [], structuredContent: ticketEnvelope('triaged') as unknown as Record<string, unknown> });
    await host.connect();
    const fragment = createFragment({ name: 'x', version: '0', render: () => undefined });
    await fragment.connect(host.appEnd);
    // Each render gets its own detached container so `mcp`'s and `http`'s bound queries
    // (which testing-library scopes to `baseElement`, not just `container`) don't see each
    // other's DOM once both cards are mounted side by side.
    const mcp = render(<EnvelopeProvider transport={mcpAppTransport(fragment.app)}><TicketCard /></EnvelopeProvider>, { container: document.createElement('div') });
    await act(async () => { await host.bridge.sendToolResult({ content: [], structuredContent: ticketEnvelope() }); });
    await vi.waitFor(() => expect(mcp.container.querySelector('article')).not.toBeNull());
    const http = render(<EnvelopeProvider transport={httpTransport(() => Promise.resolve(ticketEnvelope()))} initial={ticketEnvelope()}><TicketCard /></EnvelopeProvider>, { container: document.createElement('div') });
    expect(mcp.container.innerHTML).toBe(http.container.innerHTML);
    await act(async () => { mcp.getByRole('button', { name: 'Triage' }).click(); await Promise.resolve(); });
    await vi.waitFor(() => expect(mcp.container.querySelector('article')).toHaveAttribute('data-state', 'triaged'));
    await vi.waitFor(() => expect(host.contextUpdates).toHaveLength(1));
  });
});
