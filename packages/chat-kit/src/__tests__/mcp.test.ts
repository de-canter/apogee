import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { createKit } from '../kit';
import { AnyEnvelopeSchema } from '../contract';
import { defaultAuth, registerKit } from '../mcp';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

async function harness(authToken: string | undefined) {
  const kit = createKit<ReturnType<typeof makeCtx>, Principal>({
    resources: [ticket], ctx: makeCtx(structuredClone(seed)),
    principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
  });
  const server = new McpServer({ name: 'kit-test', version: '0.0.0' });
  registerKit(server, kit, {
    auth: () => (authToken ? { token: authToken } : undefined),
    fragments: [{ uri: 'ui://test/ticket.html', name: 'Ticket card', html: '<!doctype html><html><body>card</body></html>', csp: { connectDomains: ['https://img.example.com'] }, prefersBorder: false }],
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'harness', version: '0.0.0' });
  await server.connect(st);
  await client.connect(ct);
  return { client };
}

describe('registerKit', () => {
  it('advertises tools with outputSchema and _meta.ui', async () => {
    const { client } = await harness('ann');
    const { tools } = await client.listTools();
    const triage = tools.find((t) => t.name === 'ticket_triage')!;
    expect(triage.outputSchema).toBeDefined();
    expect(triage._meta?.ui).toEqual({ resourceUri: 'ui://test/ticket.html' });
    expect(triage.inputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'assignee']) as unknown });
    const close = tools.find((t) => t.name === 'ticket_close')!;
    expect(close._meta?.ui).toBeUndefined();
  });

  it('returns the envelope as structuredContent and a compact text for the model', async () => {
    const { client } = await harness('ann');
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't1', assignee: 'bob' } });
    expect(res.isError).toBeFalsy();
    const env = AnyEnvelopeSchema.parse(res.structuredContent);
    expect(env).toMatchObject({ resource: 'ticket', id: 't1', state: 'triaged' });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(JSON.parse(text)).toMatchObject({ state: 'triaged', next: ['ticket_close', 'ticket_note'] });
  });

  it('returns isError with the error JSON on an illegal transition', async () => {
    const { client } = await harness('ann');
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't2', assignee: 'bob' } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ error: { code: 'ILLEGAL_TRANSITION', details: { from: 'closed' } } });
  });

  it('maps a missing principal to UNAUTHENTICATED', async () => {
    const { client } = await harness(undefined);
    const res = await client.callTool({ name: 'ticket_get', arguments: { id: 't1' } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('serves the fragment as an MCP App resource with CSP metadata', async () => {
    const { client } = await harness('ann');
    const res = await client.readResource({ uri: 'ui://test/ticket.html' });
    const c = res.contents[0]!;
    expect(c.mimeType).toBe('text/html;profile=mcp-app');
    expect('text' in c && c.text).toContain('card');
    expect(c._meta).toEqual({ ui: { csp: { connectDomains: ['https://img.example.com'] }, prefersBorder: false } });
  });

  it('defaultAuth reads http.authInfo', () => {
    const ctx = { http: { authInfo: { token: 't', clientId: 'c', scopes: ['a'] } } } as unknown as Parameters<typeof defaultAuth>[0];
    expect(defaultAuth(ctx)).toEqual({ token: 't', clientId: 'c', scopes: ['a'], extra: undefined });
    expect(defaultAuth({} as unknown as Parameters<typeof defaultAuth>[0])).toBeUndefined();
  });
});
