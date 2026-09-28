import { describe, expect, it } from 'vitest';
import { createHttpHandler, STATUS_BY_CODE } from '../http';
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
});
