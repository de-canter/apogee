import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { createHttpHandler } from '../http';
import { createKit } from '../kit';
import { manifestOf } from '../manifest';
import { registerKit } from '../mcp';
import { createRemoteKit } from '../remote';
import { AnyEnvelopeSchema } from '../contract';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

async function harness() {
  const local = createKit<ReturnType<typeof makeCtx>, Principal>({
    resources: [ticket], ctx: makeCtx(structuredClone(seed)),
    principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
  });
  const handle = createHttpHandler(local);
  const remote = createRemoteKit({ manifest: manifestOf(local), call: (c, a, auth) => handle({ capability: c, args: a, auth }) });
  const server = new McpServer({ name: 'edge', version: '0.0.0' });
  registerKit(server, remote, { auth: () => ({ token: 'ann' }) });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'harness', version: '0.0.0' });
  await server.connect(st);
  await client.connect(ct);
  return { client, local };
}

describe('remote kit through a real SDK 2 server', () => {
  it('advertises the manifest schemas and ui', async () => {
    const { client } = await harness();
    const { tools } = await client.listTools();
    const triage = tools.find((t) => t.name === 'ticket_triage')!;
    expect(triage.inputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'assignee']) as unknown });
    expect(triage.outputSchema).toMatchObject({ type: 'object' });
    expect(triage._meta?.ui).toEqual({ resourceUri: 'ui://test/ticket.html' });
  });
  it('rejects bad arguments at the SDK before the call reaches the API', async () => {
    const { client } = await harness();
    await client.listTools();
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't1' } }).catch((e: unknown) => e);
    const failed = (res instanceof Error) || (typeof res === 'object' && res !== null && (res as { isError?: boolean }).isError === true);
    expect(failed).toBe(true);
  });
  it('returns the envelope with the same structuredContent and text as a local kit', async () => {
    const { client } = await harness();
    await client.listTools();
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't1', assignee: 'bob' } });
    expect(res.isError).toBeFalsy();
    expect(AnyEnvelopeSchema.parse(res.structuredContent)).toMatchObject({ state: 'triaged' });
    expect(JSON.parse((res.content as Array<{ text?: string }>)[0]?.text ?? '')).toMatchObject({ state: 'triaged' });
  });
  it('carries error codes and allowed actions back through isError results', async () => {
    const { client } = await harness();
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't2', assignee: 'bob' } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ error: { code: 'ILLEGAL_TRANSITION' } });
    expect((res.content as Array<{ text?: string }>)[0]?.text).toContain('Allowed next: ticket_note');
  });
});
