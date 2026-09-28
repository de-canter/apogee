import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { createHttpHandler } from '../http';
import { createKit, type Kit } from '../kit';
import { manifestOf } from '../manifest';
import { registerKit } from '../mcp';
import { createRemoteKit } from '../remote';
import { AnyEnvelopeSchema } from '../contract';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

function makeLocal() {
  return createKit<ReturnType<typeof makeCtx>, Principal>({
    resources: [ticket], ctx: makeCtx(structuredClone(seed)),
    principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
  });
}

async function connect(kit: Kit): Promise<Client> {
  const server = new McpServer({ name: 'edge', version: '0.0.0' });
  registerKit(server, kit, { auth: () => ({ token: 'ann' }) });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'harness', version: '0.0.0' });
  await server.connect(st);
  await client.connect(ct);
  return client;
}

/** The envelope's `at` is the call time; everything else must match exactly. */
function maskAt(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<at>')) as unknown;
}

async function harness() {
  const local = makeLocal();
  const handle = createHttpHandler(local);
  let n = 0;
  const remote = createRemoteKit({ manifest: manifestOf(local), call: (c, a, auth) => { n += 1; return handle({ capability: c, args: a, auth }); } });
  return { client: await connect(remote), local, calls: () => n };
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
    const { client, calls } = await harness();
    await client.listTools();
    // Pinned to @modelcontextprotocol/server 2.1.0: the SDK validates against the manifest's JSON
    // Schema (our Ajv Standard Schema) and RESOLVES with an isError result — it does not reject.
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't1' } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toMatch(/^Input validation error: Invalid arguments for tool ticket_triage: /);
    expect(text).toContain('assignee');
    expect(calls()).toBe(0);
  });
  it('a remote kit and the local kit it proxies are indistinguishable over MCP', async () => {
    const local = makeLocal();
    const handle = createHttpHandler(makeLocal());
    const remote = createRemoteKit({ manifest: manifestOf(local), call: (c, a, auth) => handle({ capability: c, args: a, auth }) });
    const [viaLocal, viaRemote] = await Promise.all([connect(local), connect(remote)]);
    expect((await viaRemote.listTools()).tools).toEqual((await viaLocal.listTools()).tools);
    const args = { name: 'ticket_get', arguments: { id: 't1' } };
    const [l, r] = await Promise.all([viaLocal.callTool(args), viaRemote.callTool(args)]);
    expect(l.isError).toBeFalsy();
    expect(maskAt(r)).toEqual(maskAt(l));
    const bad = { name: 'ticket_triage', arguments: { id: 't2', assignee: 'bob' } };
    const [le, re] = await Promise.all([viaLocal.callTool(bad), viaRemote.callTool(bad)]);
    expect(le.isError).toBe(true);
    expect(maskAt(re)).toEqual(maskAt(le));
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
