import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createKit } from '../kit';
import type { Envelope } from '../contract';
import { ChatKitError } from '../errors';
import type { EntitlementPort } from '../ports';
import { defineResource } from '../resource';
import { makeCtx, seed, ticket, ticketLifecycle, TicketView, type Principal, type TicketState } from './fixtures/ticket';

const auth = { token: 'ann' };
const principal = (a: { token?: string | undefined } | undefined): Promise<Principal> => {
  if (!a?.token) throw new Error('no token');
  return Promise.resolve({ user: a.token, admin: a.token === 'root' });
};
const kitFor = (entitlement?: EntitlementPort<Principal>, onError = vi.fn()) =>
  ({ kit: createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [ticket], ctx: makeCtx(structuredClone(seed)), principal, ...(entitlement ? { entitlement } : {}), onError }), onError });

describe('createKit', () => {
  it('lists capabilities and rejects duplicates', () => {
    const { kit } = kitFor();
    expect(kit.list().map((c) => c.name)).toContain('ticket_triage');
    expect(kit.get('ticket_get')?.output).toBeDefined();
    expect(() => createKit({ resources: [ticket, ticket], ctx: makeCtx(), principal })).toThrow(/duplicate/);
  });

  it('get returns an envelope with derived actions and ui', async () => {
    const { kit } = kitFor();
    const e = await kit.call('ticket_get', { id: 't1' }, auth);
    expect(e).toMatchObject({ resource: 'ticket', id: 't1', state: 'open', data: { title: 'Leak' }, ui: { resource_uri: 'ui://test/ticket.html' } });
    expect(e.allowed_next_actions.map((a) => a.capability)).toEqual(['ticket_triage', 'ticket_close', 'ticket_note', 'ticket_refresh']);
  });

  it('runs a legal transition and returns the next state', async () => {
    const { kit } = kitFor();
    const e = await kit.call('ticket_triage', { id: 't1', assignee: 'bob' }, auth);
    expect(e).toMatchObject({ state: 'triaged', data: { assignee: 'bob' } });
    expect(e.allowed_next_actions.map((a) => a.capability)).toEqual(['ticket_close', 'ticket_note']);
  });

  it('rejects an illegal transition before execute, listing what is allowed', async () => {
    const { kit } = kitFor();
    const err = await kit.call('ticket_triage', { id: 't2', assignee: 'bob' }, auth).catch((e: unknown) => e);
    expect(ChatKitError.is(err) && err.code).toBe('ILLEGAL_TRANSITION');
    expect((err as ChatKitError).details).toEqual({ resource: 'ticket', id: 't2', from: 'closed', attempted: 'ticket_triage', allowed: ['ticket_note'] });
    expect((err as ChatKitError).allowed_next_actions?.map((a) => a.capability)).toEqual(['ticket_note']);
    const still = (await kit.call('ticket_get', { id: 't2' }, auth)) as Envelope;
    expect(still.state).toBe('closed');
  });

  it('policy is enforced at call time: a non-admin reopen is FORBIDDEN with the allowed list', async () => {
    const { kit } = kitFor();
    const err = await kit.call('ticket_reopen', { id: 't2' }, auth).catch((e: unknown) => e);
    expect(ChatKitError.is(err) && err.code).toBe('FORBIDDEN');
    expect((err as ChatKitError).allowed_next_actions?.map((a) => a.capability)).toEqual(['ticket_note']);
    expect(((await kit.call('ticket_get', { id: 't2' }, auth)) as Envelope).state).toBe('closed');
    const root = await kit.call('ticket_reopen', { id: 't2' }, { token: 'root' });
    expect((root as Envelope).state).toBe('open');
  });

  it('a query whose when is false is ILLEGAL_TRANSITION with the allowed list', async () => {
    const { kit } = kitFor();
    await kit.call('ticket_triage', { id: 't1', assignee: 'bob' }, auth);
    const err = await kit.call('ticket_refresh', { id: 't1' }, auth).catch((e: unknown) => e);
    expect(ChatKitError.is(err) && err.code).toBe('ILLEGAL_TRANSITION');
    expect((err as ChatKitError).details).toEqual({ resource: 'ticket', id: 't1', from: 'triaged', attempted: 'ticket_refresh', allowed: ['ticket_close', 'ticket_note'] });
    expect((err as ChatKitError).allowed_next_actions?.map((a) => a.capability)).toEqual(['ticket_close', 'ticket_note']);
  });

  it('a transition whose when is false is ILLEGAL_TRANSITION and never executes', async () => {
    const execute = vi.fn(() => Promise.resolve({ state: 'closed' as const, view: { title: 'x', assignee: null, notes: [] } }));
    const gated = defineResource<ReturnType<typeof makeCtx>, Principal, TicketView, TicketState>({
      name: 'gated', lifecycle: ticketLifecycle, view: TicketView,
      load: () => Promise.resolve({ state: 'open', view: { title: 'x', assignee: null, notes: [] } }),
      transitions: { close: { from: 'open', to: 'closed', input: z.object({}), title: 'Close', when: (c) => c.view.assignee !== null, execute } },
    });
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [gated], ctx: makeCtx(), principal });
    await expect(kit.call('gated_close', { id: 'g1' }, auth)).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION', details: { attempted: 'gated_close', allowed: [] } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('get runs through entitlement: the view lands on the envelope, a denial rejects', async () => {
    const calls: string[] = [];
    const port: EntitlementPort<Principal> = {
      assert: (c) => { calls.push(`assert:${c.capability}`); return Promise.resolve({ ok: true, view: { reads: 1 } }); },
      settle: (c, o) => { calls.push(`settle:${c.capability}:${o.success}`); return Promise.resolve(); },
    };
    const e = (await kitFor(port).kit.call('ticket_get', { id: 't1' }, auth)) as Envelope;
    expect(e.entitlement).toEqual({ reads: 1 });
    expect(calls).toEqual(['assert:ticket_get', 'settle:ticket_get:true']);
    const deny: EntitlementPort<Principal> = { assert: () => Promise.resolve({ ok: false, reason: 'No reads left' }) };
    await expect(kitFor(deny).kit.call('ticket_get', { id: 't1' }, auth)).rejects.toMatchObject({ code: 'ENTITLEMENT', message: 'No reads left' });
  });

  it('maps errors: NOT_FOUND, INVALID_INPUT, UNAUTHENTICATED, unknown capability', async () => {
    const { kit } = kitFor();
    await expect(kit.call('ticket_get', { id: 't3' }, auth)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const invalidInput = await kit.call('ticket_get', { id: 7 }, auth).catch((e: unknown) => e);
    expect(ChatKitError.is(invalidInput) && invalidInput.code).toBe('INVALID_INPUT');
    expect((invalidInput as ChatKitError).details).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['id'] })]));
    await expect(kit.call('ticket_get', { id: 't1' }, undefined)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(kit.call('nope', {}, auth)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('runs entitlement assert before execute and settle after, and copies the view', async () => {
    const calls: string[] = [];
    const port: EntitlementPort<Principal> = {
      assert: (c) => { calls.push(`assert:${c.capability}`); return Promise.resolve({ ok: true, view: { left: 3 } }); },
      settle: (c, o) => { calls.push(`settle:${c.capability}:${o.success}`); return Promise.resolve(); },
    };
    const { kit } = kitFor(port);
    const e = (await kit.call('ticket_note', { id: 't1', text: 'hi' }, auth)) as Envelope;
    expect(e.entitlement).toEqual({ left: 3 });
    expect(e.data).toMatchObject({ notes: ['hi'] });
    expect(calls).toEqual(['assert:ticket_note', 'settle:ticket_note:true']);
  });

  it('a denial short-circuits with ENTITLEMENT and never executes', async () => {
    const port: EntitlementPort<Principal> = {
      assert: (c) => Promise.resolve(c.capability === 'ticket_note'
        ? { ok: false, reason: 'Out of notes', allowed_next_actions: [{ capability: 'ticket_get', title: 'Back', args: { id: 't1' } }] }
        : { ok: true }),
    };
    const { kit } = kitFor(port);
    const err = await kit.call('ticket_note', { id: 't1', text: 'hi' }, auth).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'ENTITLEMENT', message: 'Out of notes' });
    expect(((await kit.call('ticket_get', { id: 't1' }, auth)) as Envelope).data).toMatchObject({ notes: [] });
  });

  it('a throwing execute becomes INTERNAL and reports onError', async () => {
    const onError = vi.fn();
    const broken = { ...ticket, capabilities: () => ticket.capabilities().map((c) => c.name === 'ticket_close' ? { ...c, run: () => { throw new Error('db down'); } } : c) };
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [broken], ctx: makeCtx(structuredClone(seed)), principal, onError });
    const err = await kit.call('ticket_close', { id: 't1' }, auth).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INTERNAL', message: 'Capability failed' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }), 'ticket_close');
  });

  it('execute throwing inside the pipeline still settles with success:false', async () => {
    const settle = vi.fn(async () => {});
    const port: EntitlementPort<Principal> = { assert: () => Promise.resolve({ ok: true }), settle };
    const exploding = defineResource<ReturnType<typeof makeCtx>, Principal, TicketView, TicketState>({
      name: 'boom', lifecycle: ticketLifecycle, view: TicketView,
      load: () => Promise.resolve({ state: 'open', view: { title: 'x', assignee: null, notes: [] } }),
      transitions: { close: { from: 'open', to: 'closed', input: z.object({}), title: 'Close', execute: () => { throw new Error('db down'); } } },
    });
    const onError = vi.fn();
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [exploding], ctx: makeCtx(), principal, entitlement: port, onError });
    await expect(kit.call('boom_close', { id: 'b1' }, auth)).rejects.toMatchObject({ code: 'INTERNAL', message: 'Capability failed' });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ capability: 'boom_close' }), { success: false });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' }), 'boom_close');
  });

  it('a throwing settle does not fail the call', async () => {
    const onError = vi.fn();
    const port: EntitlementPort<Principal> = { assert: () => Promise.resolve({ ok: true }), settle: () => { throw new Error('ledger down'); } };
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [ticket], ctx: makeCtx(structuredClone(seed)), principal, entitlement: port, onError });
    const e = (await kit.call('ticket_note', { id: 't1', text: 'x' }, auth)) as Envelope;
    expect(e.state).toBe('open');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'ledger down' }), 'ticket_note:settle');
  });

  it('a corrupted store row fails the load-time view check', async () => {
    const rows = makeCtx(structuredClone(seed));
    const onError = vi.fn();
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [ticket], ctx: rows, principal, onError });
    rows.rows.get('t1')!.view = { title: 'Leak', assignee: null, notes: 'not-an-array' as unknown as string[] };
    const err = await kit.call('ticket_note', { id: 't1', text: 'x' }, auth).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INTERNAL', message: /invalid view/ });
    expect(onError).toHaveBeenCalledWith(err, 'ticket_note');
  });

  it('a transition whose execute returns an undeclared state is INTERNAL', async () => {
    const wobble = defineResource<ReturnType<typeof makeCtx>, Principal, TicketView, TicketState>({
      name: 'wobble', lifecycle: ticketLifecycle, view: TicketView,
      load: () => Promise.resolve({ state: 'open', view: { title: 'x', assignee: null, notes: [] } }),
      transitions: {
        triage: {
          from: 'open', to: 'triaged', input: z.object({}), title: 'Triage',
          // Declared legal (open -> triaged) but execute actually returns 'closed'.
          execute: () => Promise.resolve({ state: 'closed', view: { title: 'x', assignee: null, notes: [] } }),
        },
      },
    });
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [wobble], ctx: makeCtx(), principal });
    await expect(kit.call('wobble_triage', { id: 'w1' }, auth)).rejects.toMatchObject({ code: 'INTERNAL', message: /undeclared state/ });
  });

  it('a transition whose execute returns an invalid view is INTERNAL', async () => {
    const wobble = defineResource<ReturnType<typeof makeCtx>, Principal, TicketView, TicketState>({
      name: 'wobble2', lifecycle: ticketLifecycle, view: TicketView,
      load: () => Promise.resolve({ state: 'open', view: { title: 'x', assignee: null, notes: [] } }),
      transitions: {
        triage: {
          from: 'open', to: 'triaged', input: z.object({}), title: 'Triage',
          execute: () => Promise.resolve({ state: 'triaged', view: { title: 'x', assignee: null, notes: 'bad' as unknown as string[] } }),
        },
      },
    });
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [wobble], ctx: makeCtx(), principal });
    await expect(kit.call('wobble2_triage', { id: 'w1' }, auth)).rejects.toMatchObject({ code: 'INTERNAL', message: /invalid view/ });
  });

  it('a query whose execute returns an invalid view is INTERNAL', async () => {
    const wobble = defineResource<ReturnType<typeof makeCtx>, Principal, TicketView, TicketState>({
      name: 'wobble3', lifecycle: ticketLifecycle, view: TicketView,
      load: () => Promise.resolve({ state: 'open', view: { title: 'x', assignee: null, notes: [] } }),
      transitions: {},
      queries: {
        peek: {
          input: z.object({}), title: 'Peek',
          execute: () => Promise.resolve({ view: { title: 'x', assignee: null, notes: 'bad' as unknown as string[] } }),
        },
      },
    });
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [wobble], ctx: makeCtx(), principal });
    await expect(kit.call('wobble3_peek', { id: 'w1' }, auth)).rejects.toMatchObject({ code: 'INTERNAL', message: /invalid view/ });
  });

  it('a thrown ChatKitError from the principal resolver passes through unchanged', async () => {
    const forbidden = (_auth: { token?: string | undefined } | undefined): Promise<Principal> => {
      throw new ChatKitError('FORBIDDEN', 'Region blocked');
    };
    const kit = createKit<ReturnType<typeof makeCtx>, Principal>({ resources: [ticket], ctx: makeCtx(structuredClone(seed)), principal: forbidden });
    await expect(kit.call('ticket_get', { id: 't1' }, auth)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Region blocked' });
  });

  it('create and list produce envelopes; list carries the create action and a cursor', async () => {
    const { kit } = kitFor();
    const created = (await kit.call('ticket_create', { title: 'New' }, auth)) as Envelope;
    expect(created).toMatchObject({ state: 'open', data: { title: 'New' } });
    const page = await kit.call('ticket_list', { limit: 2 }, auth);
    expect('items' in page && page.items.length).toBe(2);
    expect('items' in page && page.next_cursor).toBe('t2');
    expect(page.allowed_next_actions).toEqual([{ capability: 'ticket_create', title: 'New ticket', args: {} }]);
    const rest = await kit.call('ticket_list', { limit: 2, cursor: 't2' }, auth);
    expect('items' in rest && rest.items.map((i) => i.id)).toEqual([created.id]);
  });

  it('describe uses the resource describe or the default', () => {
    const { kit } = kitFor();
    const e = { resource: 'ticket', id: 't1', state: 'open', data: { title: 'Leak', assignee: null, notes: [] }, allowed_next_actions: [], at: '2026-09-27T00:00:00.000Z' };
    expect(JSON.parse(kit.describe('ticket_get', e as never))).toMatchObject({ resource: 'ticket', id: 't1', state: 'open' });
  });
});
