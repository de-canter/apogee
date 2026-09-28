import { InMemoryTransport } from '@modelcontextprotocol/client';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { nowIso } from '@de_canter/apogee-kernel';
import type { Envelope, ListEnvelope } from '@de_canter/apogee-chat-kit';

/** A real MCP Apps host (AppBridge) on the other end of an in-memory pair. */
export function makeHost(hostContext: McpUiHostContext = { theme: 'dark' }) {
  const [appEnd, hostEnd] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(null, { name: 'test-host', version: '0.0.0' }, {}, { hostContext });
  const calls: Array<{ name: string; arguments?: Record<string, unknown> | undefined }> = [];
  const contextUpdates: unknown[] = [];
  const messages: unknown[] = [];
  const links: unknown[] = [];
  bridge.onupdatemodelcontext = (p) => { contextUpdates.push(p); return Promise.resolve({}); };
  bridge.onmessage = (p) => { messages.push(p); return Promise.resolve({}); };
  bridge.onopenlink = (p) => { links.push(p); return Promise.resolve({}); };
  return { appEnd, hostEnd, bridge, calls, contextUpdates, messages, links,
    async connect() { await bridge.connect(hostEnd); } };
}

export const ticketEnvelope = (state = 'open'): Envelope<{ title: string }> => ({
  resource: 'ticket', id: 't1', state, data: { title: 'Leak' },
  allowed_next_actions: state === 'open'
    ? [{ capability: 'ticket_triage', title: 'Triage', args: { id: 't1' }, intent: 'primary' }]
    : [{ capability: 'ticket_close', title: 'Close', args: { id: 't1' } }],
  at: nowIso(),
});

export const ticketListEnvelope = (): ListEnvelope<{ title: string }> => ({
  resource: 'ticket',
  items: [ticketEnvelope(), { ...ticketEnvelope('triaged'), id: 't2', data: { title: 'Drip' } }],
  next_cursor: null,
  allowed_next_actions: [{ capability: 'ticket_create', title: 'New ticket', args: {} }],
  at: nowIso(),
});
