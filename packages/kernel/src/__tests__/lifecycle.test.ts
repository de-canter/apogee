import { describe, expect, it } from 'vitest';
import { ref } from '../ref';
import { isoDate } from '../time';
import { IllegalTransitionError, InvalidLifecycleError, defineLifecycle } from '../lifecycle';

const order = defineLifecycle({
  states: ['draft', 'open', 'on_hold', 'closed', 'cancelled'] as const,
  initial: 'draft',
  terminal: ['closed', 'cancelled'],
  transitions: [
    { name: 'open', from: 'draft', to: 'open' },
    { name: 'hold', from: 'open', to: 'on_hold' },
    { name: 'resume', from: 'on_hold', to: 'open' },
    { name: 'close', from: 'open', to: 'closed' },
    { name: 'cancel', from: ['draft', 'open', 'on_hold'], to: 'cancelled' },
  ],
});

describe('Lifecycle', () => {
  it('answers what can happen next', () => {
    expect(order.next('open').map((t) => t.name)).toEqual(['hold', 'close', 'cancel']);
    expect(order.next('closed')).toEqual([]);
    expect(order.can('draft', 'open')).toBe(true);
    expect(order.can('draft', 'closed')).toBe(false);
    expect(order.isTerminal('cancelled')).toBe(true);
  });
  it('produces and advances LifecycleState with provenance of the change', () => {
    const s0 = order.initialState({ at: isoDate('2026-01-01') });
    expect(s0).toEqual({ state: 'draft', since: '2026-01-01T00:00:00.000Z' });
    const s1 = order.transition(s0, 'open', { at: isoDate('2026-01-02'), by: ref('Party', 'u1'), reason: 'intake complete' });
    expect(s1.state).toBe('open');
    expect(s1.by).toEqual({ kind: 'Party', id: 'u1' });
    expect(() => order.transition(s1, 'draft')).toThrow(IllegalTransitionError);
  });
  it('exposes a zod enum for the states', () => {
    expect(order.stateSchema.safeParse('open').success).toBe(true);
    expect(order.stateSchema.safeParse('nope').success).toBe(false);
  });
  it('rejects definitions with unknown states or outgoing transitions from terminal states', () => {
    expect(() => defineLifecycle({
      states: ['a', 'b'] as const, initial: 'a', terminal: ['b'],
      transitions: [{ name: 'x', from: 'a', to: 'c' as 'b' }],
    })).toThrow(InvalidLifecycleError);
    expect(() => defineLifecycle({
      states: ['a', 'b'] as const, initial: 'a', terminal: ['b'],
      transitions: [{ name: 'x', from: 'b', to: 'a' }],
    })).toThrow(InvalidLifecycleError);
  });
});
