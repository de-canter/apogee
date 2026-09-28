import { z } from 'zod';
import { defineLifecycle } from '@de_canter/apogee-kernel';
import { defineResource } from '../../resource';

export const TicketView = z.object({ title: z.string(), assignee: z.string().nullable(), notes: z.array(z.string()) });
export type TicketView = z.infer<typeof TicketView>;
export type TicketState = 'open' | 'triaged' | 'closed';

export interface TicketRow { id: string; state: TicketState; view: TicketView; owner: string }
export interface Ctx { rows: Map<string, TicketRow> }
export interface Principal { user: string; admin: boolean }

export const ticketLifecycle = defineLifecycle<TicketState>({
  states: ['open', 'triaged', 'closed'],
  initial: 'open',
  terminal: [],
  transitions: [
    { name: 'triage', from: 'open', to: 'triaged' },
    { name: 'close', from: ['open', 'triaged'], to: 'closed' },
    { name: 'reopen', from: 'closed', to: 'open' },
  ],
});

export const TriageInput = z.object({ assignee: z.string().min(1) });
export const NoteInput = z.object({ text: z.string().min(1) });
export const CreateInput = z.object({ title: z.string().min(1) });
export const ListInput = z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(50).default(10) });

export function makeCtx(rows: TicketRow[] = []): Ctx {
  return { rows: new Map(rows.map((r) => [r.id, r])) };
}

export const seed: TicketRow[] = [
  { id: 't1', state: 'open', view: { title: 'Leak', assignee: null, notes: [] }, owner: 'ann' },
  { id: 't2', state: 'closed', view: { title: 'Done', assignee: 'bob', notes: [] }, owner: 'ann' },
  { id: 't3', state: 'triaged', view: { title: 'Other', assignee: 'cy', notes: [] }, owner: 'zed' },
];

let nextId = 100;

export const ticket = defineResource<Ctx, Principal, TicketView, TicketState>({
  name: 'ticket',
  lifecycle: ticketLifecycle,
  view: TicketView,
  load: (id, { ctx, principal }) => {
    const row = ctx.rows.get(id);
    if (!row || (row.owner !== principal.user && !principal.admin)) return Promise.resolve(null);
    return Promise.resolve({ state: row.state, view: row.view });
  },
  create: {
    input: CreateInput,
    title: 'New ticket',
    execute: (input: z.infer<typeof CreateInput>, { ctx, principal }) => {
      const id = `t${nextId++}`;
      const row: TicketRow = { id, state: 'open', view: { title: input.title, assignee: null, notes: [] }, owner: principal.user };
      ctx.rows.set(id, row);
      return Promise.resolve({ id, state: row.state, view: row.view });
    },
  },
  list: {
    input: ListInput,
    title: 'List tickets',
    execute: (input: z.infer<typeof ListInput>, { ctx, principal }) => {
      const mine = [...ctx.rows.values()].filter((r) => r.owner === principal.user || principal.admin);
      const start = input.cursor ? mine.findIndex((r) => r.id === input.cursor) + 1 : 0;
      const page = mine.slice(start, start + input.limit);
      const last = page[page.length - 1];
      const next_cursor = last && start + input.limit < mine.length ? last.id : null;
      return Promise.resolve({ items: page.map((r) => ({ id: r.id, state: r.state, view: r.view })), next_cursor });
    },
  },
  transitions: {
    triage: {
      from: 'open', to: 'triaged', input: TriageInput, title: 'Triage', intent: 'primary',
      execute: (input: z.infer<typeof TriageInput>, { ctx, id, current }) => {
        const view = { ...current.view, assignee: input.assignee };
        ctx.rows.set(id, { ...ctx.rows.get(id)!, state: 'triaged', view });
        return Promise.resolve({ state: 'triaged', view });
      },
    },
    close: {
      from: ['open', 'triaged'], to: 'closed', input: z.object({}), title: 'Close', intent: 'destructive',
      execute: (_input: Record<string, never>, { ctx, id, current }) => {
        ctx.rows.set(id, { ...ctx.rows.get(id)!, state: 'closed' });
        return Promise.resolve({ state: 'closed', view: current.view });
      },
    },
    reopen: {
      from: 'closed', to: 'open', input: z.object({}), title: 'Reopen',
      execute: (_input: Record<string, never>, { ctx, id, current }) => {
        ctx.rows.set(id, { ...ctx.rows.get(id)!, state: 'open' });
        return Promise.resolve({ state: 'open', view: current.view });
      },
    },
  },
  queries: {
    note: {
      input: NoteInput, title: 'Add note',
      execute: (input: z.infer<typeof NoteInput>, { ctx, id, current }) => {
        const view = { ...current.view, notes: [...current.view.notes, input.text] };
        ctx.rows.set(id, { ...ctx.rows.get(id)!, view });
        return Promise.resolve({ view });
      },
    },
    refresh: {
      input: z.object({}), title: 'Refresh', intent: 'poll',
      when: (current) => current.state === 'open',
      execute: (_input: Record<string, never>, { current }) => Promise.resolve({ view: current.view }),
    },
  },
  policy: (t, _current, principal) => (t.name === 'reopen' ? principal.admin : true),
  ui: { get: 'ui://test/ticket.html', triage: 'ui://test/ticket.html' },
});
