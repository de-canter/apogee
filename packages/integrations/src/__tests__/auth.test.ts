import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AUTH, clearTokenCache, getAuthMethod, maskHeaders, redactUrl, signJwt, verifyJwt, type OutboundRequest } from '../auth';
import { IntegrationsError } from '../errors';

const base: OutboundRequest = { method: 'POST', url: 'https://api.mock.apogee.build/weather?lat=1', headers: { 'content-type': 'application/json' }, body: '{"a":1}' };
const deps = { fetch: (() => Promise.reject(new Error('no network'))) as unknown as typeof fetch, now: () => 1_700_000_000_000 };

describe('api_key', () => {
  it('injects in a header or a query param and verifies', async () => {
    const m = AUTH.api_key;
    const h = await m.inject(base, 'k1', { name: 'X-Api-Key', prefix: 'Key ' }, deps);
    expect(h.headers['X-Api-Key']).toBe('Key k1');
    const q = await m.inject(base, 'k1', { placement: 'query', name: 'key' }, deps);
    expect(q.url).toBe('https://api.mock.apogee.build/weather?lat=1&key=k1');
    expect((await m.verify({ headers: { 'x-api-key': 'k1' }, rawBody: '' }, 'k1', {}, deps)).valid).toBe(true);
    expect((await m.verify({ headers: { 'x-api-key': 'nope' }, rawBody: '' }, 'k1', {}, deps))).toMatchObject({ valid: false, error: expect.stringContaining('API key') as string });
    expect((await m.verify({ headers: {}, rawBody: '' }, 'k1', { placement: 'query' }, deps)).valid).toBe(false);
  });
});

describe('basic', () => {
  it('encodes user:pass and verifies with the username as identity', async () => {
    const m = AUTH.basic;
    const r = await m.inject(base, 'sam:secret', {}, deps);
    expect(r.headers['Authorization']).toBe(`Basic ${Buffer.from('sam:secret').toString('base64')}`);
    expect(await m.verify({ headers: { authorization: r.headers['Authorization']! }, rawBody: '' }, 'sam:secret', {}, deps)).toEqual({ valid: true, identity: 'sam' });
    expect((await m.verify({ headers: { authorization: 'Basic nope' }, rawBody: '' }, 'sam:secret', {}, deps)).valid).toBe(false);
  });
});

describe('hmac', () => {
  it('signs the body and verifies timing-safely', async () => {
    const m = AUTH.hmac;
    const r = await m.inject(base, 'shh', { header: 'X-Signature', prefix: 'sha256=' }, deps);
    const expected = `sha256=${createHmac('sha256', 'shh').update('{"a":1}').digest('hex')}`;
    expect(r.headers['X-Signature']).toBe(expected);
    expect((await m.verify({ headers: { 'x-signature': expected }, rawBody: '{"a":1}' }, 'shh', { prefix: 'sha256=' }, deps)).valid).toBe(true);
    expect((await m.verify({ headers: { 'x-signature': expected }, rawBody: '{"a":2}' }, 'shh', { prefix: 'sha256=' }, deps)).valid).toBe(false);
    expect((await m.verify({ headers: {}, rawBody: '' }, 'shh', {}, deps)).error).toContain('signature');
  });
});

describe('jwt_bearer', () => {
  it('signs HS256 with claims and verifies issuer, audience, and expiry', async () => {
    const m = AUTH.jwt_bearer;
    const r = await m.inject(base, 'jwt-secret', { issuer: 'apogee', audience: 'mock', subject: 'desk', expiresInSec: 300, claims: { role: 'admin' } }, deps);
    const token = r.headers['Authorization']!.replace('Bearer ', '');
    const claims = verifyJwt(token, 'jwt-secret', { now: deps.now });
    expect(claims).toMatchObject({ iss: 'apogee', aud: 'mock', sub: 'desk', role: 'admin', iat: 1_700_000_000, exp: 1_700_000_300 });
    expect(await m.verify({ headers: { authorization: `Bearer ${token}` }, rawBody: '' }, 'jwt-secret', { issuer: 'apogee', audience: 'mock' }, deps)).toEqual({ valid: true, identity: 'desk' });
    expect((await m.verify({ headers: { authorization: `Bearer ${token}` }, rawBody: '' }, 'wrong', {}, deps)).valid).toBe(false);
    expect((await m.verify({ headers: { authorization: `Bearer ${token}` }, rawBody: '' }, 'jwt-secret', { issuer: 'other' }, deps)).error).toContain('issuer');
    expect(() => verifyJwt(token, 'jwt-secret', { now: () => deps.now() + 400_000 })).toThrow(/expired/);
    expect(() => verifyJwt(signJwt({ sub: 'x' }, 'x', { alg: 'none' }), 'x')).toThrow(/algorithm/);
  });
});

describe('oauth2', () => {
  it('fetches a client-credentials token once and caches it', async () => {
    clearTokenCache();
    const calls: Array<{ url: string; body: string }> = [];
    const fetchStub = ((url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as unknown as typeof fetch;
    const m = AUTH.oauth2;
    const secret = JSON.stringify({ clientId: 'c', clientSecret: 's', tokenUrl: 'https://api.mock.apogee.build/token', scope: 'weather' });
    const r1 = await m.inject(base, secret, {}, { ...deps, fetch: fetchStub });
    expect(r1.headers['Authorization']).toBe('Bearer tok-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.mock.apogee.build/token');
    expect(calls[0]!.body).toContain('grant_type=client_credentials');
    expect(calls[0]!.body).toContain('scope=weather');
    await m.inject(base, secret, {}, { ...deps, fetch: fetchStub });
    expect(calls).toHaveLength(1);
    await m.inject(base, secret, {}, { ...deps, fetch: fetchStub, now: () => deps.now() + 3600_000 });
    expect(calls).toHaveLength(2);
    expect((await m.verify({ headers: { authorization: 'Bearer x' }, rawBody: '' }, secret, {}, deps))).toMatchObject({ valid: false, error: expect.stringContaining('introspection') as string });
    const introspect = (() => Promise.resolve(new Response(JSON.stringify({ active: true, sub: 'svc' }), { status: 200 }))) as unknown as typeof fetch;
    expect(await m.verify({ headers: { authorization: 'Bearer x' }, rawBody: '' }, secret, { introspectionUrl: 'https://api.mock.apogee.build/introspect' }, { ...deps, fetch: introspect })).toEqual({ valid: true, identity: 'svc' });
  });
});

describe('registry and masking', () => {
  it('looks up methods and masks secrets', () => {
    expect(getAuthMethod('hmac').name).toBe('hmac');
    expect(() => getAuthMethod('magic')).toThrow(IntegrationsError);
    expect(maskHeaders({ Authorization: 'Bearer abcdefghijk', 'X-API-Key': 'demo-key-123', Accept: 'application/json' })).toEqual({ Authorization: 'Bearer***', 'X-API-Key': 'demo-k***', Accept: 'application/json' });
    expect(redactUrl('https://x.y/z?key=1')).toBe('https://x.y/z?[redacted]');
    expect(redactUrl('https://x.y/z')).toBe('https://x.y/z');
  });
});
