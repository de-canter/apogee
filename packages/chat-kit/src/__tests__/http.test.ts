import { describe, expect, it } from 'vitest';
import { createHttpHandler, KIT_WRAP_HEADER, STATUS_BY_CODE, wantsWrap } from '../http';
import { createKit } from '../kit';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

const kit = createKit<ReturnType<typeof makeCtx>, Principal>({
  resources: [ticket], ctx: makeCtx(structuredClone(seed)),
  principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
});
const handle = createHttpHandler(kit);

describe('createHttpHandler', () => {
  it('200 with the envelope', async () => {
    const r = await handle({ capability: 'ticket_get', args: { id: 't1' }, auth: { token: 'ann' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ resource: 'ticket', id: 't1' });
    expect(JSON.parse(r.text ?? '')).toMatchObject({ resource: 'ticket', id: 't1' });
  });
  it.each([
    ['ticket_triage', { id: 't2', assignee: 'b' }, { token: 'ann' }, 409, 'ILLEGAL_TRANSITION'],
    ['ticket_get', { id: 'zzz' }, { token: 'ann' }, 404, 'NOT_FOUND'],
    ['ticket_get', { id: 1 }, { token: 'ann' }, 400, 'INVALID_INPUT'],
    ['ticket_get', { id: 't1' }, undefined, 401, 'UNAUTHENTICATED'],
  ] as const)('%s → %i', async (capability, args, auth, status, code) => {
    const r = await handle({ capability, args, auth });
    expect(r.status).toBe(status);
    expect(r.body).toMatchObject({ error: { code } });
    expect(r.text).toBeUndefined();
  });
  it('exports the status map', () => { expect(STATUS_BY_CODE.ENTITLEMENT).toBe(402); });
  it('wraps a success body as { envelope, text } when asked, leaving the status alone', async () => {
    const r = await handle({ capability: 'ticket_get', args: { id: 't1' }, auth: { token: 'ann' }, wrap: true });
    expect(r.status).toBe(200);
    const body = r.body as { envelope: unknown; text: string };
    expect(Object.keys(body).sort()).toEqual(['envelope', 'text']);
    expect(body.envelope).toMatchObject({ resource: 'ticket', id: 't1' });
    expect(body.text).toBe(r.text);
    expect(JSON.parse(body.text)).toMatchObject({ resource: 'ticket', id: 't1' });
  });
  it('keeps the plain envelope body when wrap is false', async () => {
    const r = await handle({ capability: 'ticket_get', args: { id: 't1' }, auth: { token: 'ann' }, wrap: false });
    expect(r.body).toMatchObject({ resource: 'ticket', id: 't1' });
    expect('envelope' in (r.body as object)).toBe(false);
    expect(typeof r.text).toBe('string');
  });
  it('never wraps an error body', async () => {
    const r = await handle({ capability: 'ticket_get', args: { id: 'zzz' }, auth: { token: 'ann' }, wrap: true });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(r.text).toBeUndefined();
  });
});

describe('wantsWrap', () => {
  it('reads the header from a Headers-like object', () => {
    expect(KIT_WRAP_HEADER).toBe('x-kit-wrap');
    expect(wantsWrap(new Headers({ [KIT_WRAP_HEADER]: '1' }))).toBe(true);
    expect(wantsWrap(new Headers({ [KIT_WRAP_HEADER]: '0' }))).toBe(false);
    expect(wantsWrap(new Headers())).toBe(false);
  });
  it('reads the header from a plain record (Node/Fastify request.headers)', () => {
    expect(wantsWrap({ 'x-kit-wrap': '1' })).toBe(true);
    expect(wantsWrap({ 'X-Kit-Wrap': '1' })).toBe(true);
    expect(wantsWrap({ 'x-kit-wrap': ['1'] })).toBe(true);
    expect(wantsWrap({ 'x-kit-wrap': 'yes' })).toBe(false);
    expect(wantsWrap({ 'x-kit-wrap': undefined })).toBe(false);
    expect(wantsWrap({})).toBe(false);
  });
});
