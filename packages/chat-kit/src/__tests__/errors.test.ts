import { describe, expect, it } from 'vitest';
import { ChatKitError, STATUS_BY_CODE } from '../errors';

describe('ChatKitError', () => {
  it('serializes to the error envelope, omitting empty fields', () => {
    const e = new ChatKitError('NOT_FOUND', 'No ticket t9');
    expect(e.toJSON()).toEqual({ error: { code: 'NOT_FOUND', message: 'No ticket t9' } });
    expect(e.name).toBe('ChatKitError');
    expect(ChatKitError.is(e)).toBe(true);
    expect(ChatKitError.is(new Error('x'))).toBe(false);
  });
  it('carries details and allowed_next_actions', () => {
    const e = new ChatKitError('ILLEGAL_TRANSITION', 'closed -> triaged', {
      details: { resource: 'ticket', id: 't1', from: 'closed', attempted: 'ticket_triage', allowed: ['ticket_reopen'] },
      allowed_next_actions: [{ capability: 'ticket_reopen', title: 'Reopen', args: { id: 't1' } }],
    });
    expect(e.toJSON().error.details).toEqual({ resource: 'ticket', id: 't1', from: 'closed', attempted: 'ticket_triage', allowed: ['ticket_reopen'] });
    expect(e.toJSON().error.allowed_next_actions?.[0]?.capability).toBe('ticket_reopen');
  });
  it('is() is a brand check that survives a second copy of the class', () => {
    const copy = Object.assign(new Error('from another bundle'), { code: 'NOT_FOUND' });
    Object.defineProperty(copy, Symbol.for('apogee.chat-kit.error'), { value: true });
    expect(ChatKitError.is(copy)).toBe(true);
    expect(ChatKitError.is(Object.assign(new Error('plain'), { code: 'NOT_FOUND' }))).toBe(false);
    expect(ChatKitError.is(null)).toBe(false);
    const noCode = new Error('no code');
    Object.defineProperty(noCode, Symbol.for('apogee.chat-kit.error'), { value: true });
    expect(ChatKitError.is(noCode)).toBe(false);
  });
  it('maps every code to a status', () => {
    expect(STATUS_BY_CODE).toEqual({ ILLEGAL_TRANSITION: 409, NOT_FOUND: 404, INVALID_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, ENTITLEMENT: 402, INTERNAL: 500 });
  });
});
