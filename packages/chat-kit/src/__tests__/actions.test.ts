import { describe, expect, it } from 'vitest';
import { deriveActions } from '../actions';
import { ticket, type Principal } from './fixtures/ticket';

const ann: Principal = { user: 'ann', admin: false };
const root: Principal = { user: 'root', admin: true };
const view = { title: 'Leak', assignee: null, notes: [] };

describe('deriveActions', () => {
  it('lists transitions legal from the state, then queries', () => {
    const actions = deriveActions(ticket, 't1', { state: 'open', view }, ann);
    expect(actions.map((a) => a.capability)).toEqual(['ticket_triage', 'ticket_close', 'ticket_note', 'ticket_refresh']);
    expect(actions[0]).toEqual({ capability: 'ticket_triage', title: 'Triage', args: { id: 't1' }, intent: 'primary' });
    expect(actions[2]).toEqual({ capability: 'ticket_note', title: 'Add note', args: { id: 't1' } });
  });
  it('honours `when` on queries', () => {
    const actions = deriveActions(ticket, 't1', { state: 'triaged', view }, ann);
    expect(actions.map((a) => a.capability)).toEqual(['ticket_close', 'ticket_note']);
  });
  it('honours policy per principal', () => {
    expect(deriveActions(ticket, 't2', { state: 'closed', view }, ann).map((a) => a.capability)).toEqual(['ticket_note']);
    expect(deriveActions(ticket, 't2', { state: 'closed', view }, root).map((a) => a.capability)).toEqual(['ticket_reopen', 'ticket_note']);
  });
});
