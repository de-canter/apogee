import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineLifecycle } from '@de_canter/apogee-kernel';
import { defineResource } from '../resource';
import { ticket, ticketLifecycle, TicketView, type Ctx, type Principal, type TicketState } from './fixtures/ticket';

const base = {
  name: 'ticket', lifecycle: ticketLifecycle, view: TicketView,
  load: () => Promise.resolve(null),
  transitions: {},
};

describe('defineResource', () => {
  it('generates capability names and schemas', () => {
    const names = ticket.capabilities().map((c) => c.name);
    expect(names).toEqual(['ticket_get', 'ticket_list', 'ticket_create', 'ticket_triage', 'ticket_close', 'ticket_reopen', 'ticket_note', 'ticket_refresh']);
    const triage = ticket.capabilities().find((c) => c.name === 'ticket_triage')!;
    expect(triage.input.safeParse({ id: 't1', assignee: 'ann' }).success).toBe(true);
    expect(triage.input.safeParse({ assignee: 'ann' }).success).toBe(false);
    expect(triage.ui).toBe('ui://test/ticket.html');
    expect(triage.resource).toBe('ticket');
    expect(ticket.capabilities().find((c) => c.name === 'ticket_close')!.ui).toBeUndefined();
  });
  it('rejects a transition from a state the lifecycle does not allow', () => {
    expect(() => defineResource<Ctx, Principal, z.infer<typeof TicketView>, TicketState>({
      ...base,
      transitions: { bad: { from: 'closed', to: 'triaged', input: z.object({}), title: 'Bad', execute: (_i: Record<string, never>, c) => Promise.resolve({ state: 'triaged', view: c.current.view }) } },
    })).toThrow(/closed -> triaged/);
  });
  it('rejects an unknown state name', () => {
    expect(() => defineResource<Ctx, Principal, z.infer<typeof TicketView>, TicketState>({
      ...base,
      transitions: { bad: { from: 'open', to: 'archived' as TicketState, input: z.object({}), title: 'Bad', execute: (_i: Record<string, never>, c) => Promise.resolve({ state: 'open', view: c.current.view }) } },
    })).toThrow(/archived/);
  });
  it('rejects reserved and colliding capability names', () => {
    expect(() => defineResource<Ctx, Principal, z.infer<typeof TicketView>, TicketState>({
      ...base, transitions: {}, queries: { get: { input: z.object({}), title: 'x', execute: (_i: Record<string, never>, c) => Promise.resolve({ view: c.current.view }) } },
    })).toThrow(/reserved/);
    expect(() => defineResource<Ctx, Principal, z.infer<typeof TicketView>, TicketState>({
      ...base,
      transitions: { note: { from: 'open', to: 'open', input: z.object({}), title: 'x', execute: (_i: Record<string, never>, c) => Promise.resolve({ state: 'open', view: c.current.view }) } },
      queries: { note: { input: z.object({}), title: 'x', execute: (_i: Record<string, never>, c) => Promise.resolve({ view: c.current.view }) } },
    })).toThrow(/collides/);
  });
  it('rejects an input that already declares id', () => {
    expect(() => defineResource<Ctx, Principal, z.infer<typeof TicketView>, TicketState>({
      ...base, transitions: {},
      queries: { peek: { input: z.object({ id: z.string() }), title: 'x', execute: (_i: { id: string }, c) => Promise.resolve({ view: c.current.view }) } },
    })).toThrow(/"id"/);
  });
  it('rejects a bad resource name', () => {
    const lc = defineLifecycle<'a'>({ states: ['a'], initial: 'a', terminal: [], transitions: [] });
    expect(() => defineResource<Ctx, Principal, unknown, 'a'>({ name: 'Bad-Name', lifecycle: lc, view: z.unknown(), load: () => Promise.resolve(null), transitions: {} })).toThrow(/snake_case/);
  });
});
