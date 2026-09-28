import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { nowIso } from '@de_canter/apogee-kernel';
import {
  AnyEnvelopeSchema, AnyListEnvelopeSchema, describeEnvelope, envelopeSchema, isListEnvelope,
  listEnvelopeSchema, STATELESS, type Envelope, type ListEnvelope,
} from '../contract';

const View = z.object({ title: z.string() });

const env: Envelope<{ title: string }> = {
  resource: 'ticket', id: 't1', state: 'open', data: { title: 'Leak' },
  allowed_next_actions: [{ capability: 'ticket_triage', title: 'Triage', args: { id: 't1' }, intent: 'primary' }],
  at: nowIso(),
};

describe('envelope schemas', () => {
  it('accepts a valid envelope and rejects a bad action', () => {
    expect(envelopeSchema(View).parse(env)).toEqual(env);
    expect(() => envelopeSchema(View).parse({ ...env, allowed_next_actions: [{ capability: '' }] })).toThrow();
  });
  it('accepts ui and entitlement when present', () => {
    const withUi = { ...env, ui: { resource_uri: 'ui://x/card.html' }, entitlement: { scans_left: 2 } };
    expect(AnyEnvelopeSchema.parse(withUi)).toEqual(withUi);
  });
  it('validates a list envelope', () => {
    const list: ListEnvelope<{ title: string }> = { resource: 'ticket', items: [env], next_cursor: null, allowed_next_actions: [], at: nowIso() };
    expect(listEnvelopeSchema(View).parse(list)).toEqual(list);
    expect(AnyListEnvelopeSchema.safeParse({ ...list, items: [{ nope: true }] }).success).toBe(false);
    expect(isListEnvelope(list)).toBe(true);
    expect(isListEnvelope(env)).toBe(false);
  });
  it('STATELESS is the dash', () => { expect(STATELESS).toBe('-'); });
});

describe('describeEnvelope', () => {
  it('is compact JSON with capability names only', () => {
    const text = describeEnvelope(env);
    expect(JSON.parse(text)).toEqual({ resource: 'ticket', id: 't1', state: 'open', data: { title: 'Leak' }, next: ['ticket_triage'] });
  });
  it('describes a list by item and next capabilities', () => {
    const list: ListEnvelope = { resource: 'ticket', items: [env], next_cursor: 'c2', allowed_next_actions: [{ capability: 'ticket_create', title: 'New', args: {} }], at: nowIso() };
    expect(JSON.parse(describeEnvelope(list))).toEqual({ resource: 'ticket', items: [{ id: 't1', state: 'open', data: { title: 'Leak' } }], next_cursor: 'c2', next: ['ticket_create'] });
  });
});
