import { describe, expect, it, vi } from 'vitest';
import { createHttpHandler } from '../http';
import { createKit } from '../kit';
import { manifestOf } from '../manifest';
import { createRemoteKit, httpKitCall, KitManifestSchema, type KitManifest, type RemoteCall } from '../remote';
import { KIT_WRAP_HEADER } from '../http';
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
  it('rejects an invalid manifest with a clear error', () => {
    const call: RemoteCall = () => Promise.reject(new Error('unused'));
    const errorBody = { error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } } as unknown as KitManifest;
    expect(() => createRemoteKit({ manifest: errorBody, call })).toThrow(/^createRemoteKit: invalid manifest: /);
    const v2 = { ...manifest, version: 2 } as unknown as KitManifest;
    expect(() => createRemoteKit({ manifest: v2, call })).toThrow(/^createRemoteKit: invalid manifest: version/);
    const noSchema = { version: 1, capabilities: [{ ...manifest.capabilities[0], input_schema: 'nope' }] } as unknown as KitManifest;
    expect(() => createRemoteKit({ manifest: noSchema, call })).toThrow(/^createRemoteKit: invalid manifest: capabilities\.0\.input_schema/);
    expect(KitManifestSchema.safeParse(manifest).success).toBe(true);
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

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const asFetch = (f: unknown): typeof fetch => f as typeof fetch;

describe('httpKitCall', () => {
  it('posts JSON with the bearer token, static headers and the wrap header, and unwraps { envelope, text }', async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe('https://api.example.com/api/v1/kit/ticket_get');
      const h = init.headers as Record<string, string>;
      expect(h['authorization']).toBe('Bearer tok');
      expect(h['x-edge']).toBe('s3cret');
      expect(h[KIT_WRAP_HEADER]).toBe('1');
      expect(init.body).toBe(JSON.stringify({ id: 't1' }));
      return Promise.resolve(jsonResponse({ envelope: { resource: 'ticket' }, text: 'hello' }));
    });
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', headers: { 'x-edge': 's3cret' }, fetch: asFetch(fetchMock) });
    const r = await call('ticket_get', { id: 't1' }, { token: 'tok' });
    expect(r).toEqual({ status: 200, body: { resource: 'ticket' }, text: 'hello' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('accepts a bare envelope on a 2xx from a plain host (no text)', async () => {
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: asFetch(() => Promise.resolve(jsonResponse({ resource: 'ticket' }))) });
    const r = await call('ticket_get', { id: 't1' }, { token: 'tok' });
    expect(r).toEqual({ status: 200, body: { resource: 'ticket' } });
  });
  it('returns a 40 KB text in a wrapped body intact', async () => {
    const big = 'Château — 2019 · '.repeat(2400);
    expect(big.length).toBeGreaterThan(40_000);
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: asFetch(() => Promise.resolve(jsonResponse({ envelope: { resource: 'ticket' }, text: big }))) });
    const r = await call('ticket_list', {}, { token: 'tok' });
    expect(r.text).toBe(big);
  });
  it('omits Authorization without a token and tolerates a non-JSON body', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      expect('authorization' in (init.headers as Record<string, string>)).toBe(false);
      return Promise.resolve(new Response('nope', { status: 401 }));
    });
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: asFetch(fetchMock) });
    const r = await call('ticket_get', { id: 't1' }, undefined);
    expect(r.status).toBe(401);
    expect(r.body).toBe('nope');
    expect(r.text).toBeUndefined();
  });
  it('does not unwrap a non-2xx body that happens to look wrapped', async () => {
    const body = { envelope: { resource: 'ticket' }, text: 'x' };
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: asFetch(() => Promise.resolve(jsonResponse(body, 500))) });
    const r = await call('ticket_get', {}, undefined);
    expect(r).toEqual({ status: 500, body });
  });
});

describe('wrapped transport end to end', () => {
  const wrappedFetch = (textOverride?: string) => asFetch(async (url: string, init: RequestInit) => {
    const capability = decodeURIComponent(url.split('/').pop() ?? '');
    const h = init.headers as Record<string, string>;
    const token = h['authorization']?.replace(/^Bearer /, '');
    const r = await handle({ capability, args: JSON.parse(init.body as string) as unknown, auth: token ? { token } : undefined, wrap: h[KIT_WRAP_HEADER] === '1' });
    const body = textOverride !== undefined && r.status === 200 ? { ...(r.body as object), text: textOverride } : r.body;
    return jsonResponse(body, r.status);
  });
  it('carries a non-ASCII describe text through createRemoteKit(...).describe', async () => {
    const remote = createRemoteKit({ manifest, call: httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: wrappedFetch('Château — 2019') }) });
    const e = await remote.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(e).toMatchObject({ resource: 'ticket', id: 't1' });
    expect(remote.describe('ticket_get', e)).toBe('Château — 2019');
  });
  it('falls back to describeEnvelope when the host drops the wrapper', async () => {
    const plain = asFetch(async (url: string, init: RequestInit) => {
      const capability = decodeURIComponent(url.split('/').pop() ?? '');
      const r = await handle({ capability, args: JSON.parse(init.body as string) as unknown, auth: { token: 'ann' } });
      return jsonResponse(r.body, r.status);
    });
    const remote = createRemoteKit({ manifest, call: httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: plain }) });
    const e = await remote.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(JSON.parse(remote.describe('ticket_get', e))).toMatchObject({ id: 't1' });
  });
});
