import { describe, expect, it, vi } from 'vitest';
import { createHttpHandler } from '../http';
import { createKit } from '../kit';
import { manifestOf } from '../manifest';
import { createRemoteKit, httpKitCall, KIT_TEXT_HEADER, type RemoteCall } from '../remote';
import { ChatKitError } from '../errors';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

const local = createKit<ReturnType<typeof makeCtx>, Principal>({
  resources: [ticket], ctx: makeCtx(structuredClone(seed)),
  principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
});
const handle = createHttpHandler(local);
const viaHttp: RemoteCall = (capability, args, auth) => handle({ capability, args, auth });
const manifest = manifestOf(local);

describe('createRemoteKit', () => {
  it('lists capabilities with Standard Schemas built from the manifest', () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    expect(remote.list().map((c) => c.name)).toEqual(local.list().map((c) => c.name));
    const triage = remote.get('ticket_triage')!;
    expect(triage.ui).toBe('ui://test/ticket.html');
    const std = (triage.input as unknown as { '~standard': { validate(v: unknown): unknown } })['~standard'];
    expect(std.validate({ id: 't1', assignee: 'bob' })).toEqual({ value: { id: 't1', assignee: 'bob' } });
    expect('issues' in (std.validate({ id: 't1' }) as object)).toBe(true);
  });
  it('proxies a call and returns the envelope', async () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    const e = await remote.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(e).toMatchObject({ resource: 'ticket', id: 't1', state: 'open' });
  });
  it('rethrows the API error with its code and allowed actions', async () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    const err = await remote.call('ticket_triage', { id: 't2', assignee: 'b' }, { token: 'ann' }).catch((e: unknown) => e);
    expect(ChatKitError.is(err) && err.code).toBe('ILLEGAL_TRANSITION');
    expect((err as ChatKitError).allowed_next_actions?.map((a) => a.capability)).toEqual(['ticket_note']);
    await expect(remote.call('ticket_get', { id: 't1' }, undefined)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(remote.call('nope', {}, { token: 'ann' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('maps a non-error non-2xx body and a non-envelope 2xx body to INTERNAL', async () => {
    const remote = createRemoteKit({ manifest, call: () => Promise.resolve({ status: 502, body: '<html>bad gateway</html>' }) });
    await expect(remote.call('ticket_get', { id: 't1' }, { token: 'ann' })).rejects.toMatchObject({ code: 'INTERNAL' });
    const remote2 = createRemoteKit({ manifest, call: () => Promise.resolve({ status: 200, body: { nope: true } }) });
    await expect(remote2.call('ticket_get', { id: 't1' }, { token: 'ann' })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('describe uses the transported text and falls back to describeEnvelope', async () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    const e = await remote.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(JSON.parse(remote.describe('ticket_get', e))).toMatchObject({ id: 't1', next: expect.any(Array) as unknown });
    const custom = createRemoteKit({ manifest, call: (c, a, auth) => handle({ capability: c, args: a, auth }).then((r) => ({ ...r, text: 'server says hi' })) });
    const e2 = await custom.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(custom.describe('ticket_get', e2)).toBe('server says hi');
  });
  it('proxies the list capability through the http handler', async () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    // ann owns t1 + t2 from the seed; create a third so a limit-2 page has a next cursor.
    await remote.call('ticket_create', { title: 'New' }, { token: 'ann' });
    const page = await remote.call('ticket_list', { limit: 2 }, { token: 'ann' });
    expect('items' in page && page.items.length).toBe(2);
    expect('items' in page && page.next_cursor).toBe('t2');
  });
});

describe('httpKitCall', () => {
  it('posts JSON with the bearer token and static headers, and decodes the text header', async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe('https://api.example.com/api/v1/kit/ticket_get');
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
      expect((init.headers as Record<string, string>)['x-edge']).toBe('s3cret');
      expect(init.body).toBe(JSON.stringify({ id: 't1' }));
      const text = Buffer.from('hello', 'utf8').toString('base64url');
      return Promise.resolve(new Response(JSON.stringify({ resource: 'ticket' }), { status: 200, headers: { 'content-type': 'application/json', [KIT_TEXT_HEADER]: text } }));
    });
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', headers: { 'x-edge': 's3cret' }, fetch: fetchMock as unknown as typeof fetch });
    const r = await call('ticket_get', { id: 't1' }, { token: 'tok' });
    expect(r).toEqual({ status: 200, body: { resource: 'ticket' }, text: 'hello' });
  });
  it('omits Authorization without a token, tolerates a bad text header and a non-JSON body', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      expect('authorization' in (init.headers as Record<string, string>)).toBe(false);
      return Promise.resolve(new Response('nope', { status: 401, headers: { [KIT_TEXT_HEADER]: '%%%' } }));
    });
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: fetchMock as unknown as typeof fetch });
    const r = await call('ticket_get', { id: 't1' }, undefined);
    expect(r.status).toBe(401);
    expect(r.body).toBe('nope');
    expect(r.text).toBeUndefined();
  });
});
