import { describe, expect, it } from 'vitest';
import { createKit } from '../kit';
import { manifestOf } from '../manifest';
import { createRemoteKit } from '../remote';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

const kit = createKit<ReturnType<typeof makeCtx>, Principal>({
  resources: [ticket], ctx: makeCtx(structuredClone(seed)),
  principal: (a) => Promise.resolve({ user: a?.token ?? 'ann', admin: false }),
});

describe('manifestOf', () => {
  it('lists every capability with JSON Schemas and ui', () => {
    const m = manifestOf(kit);
    expect(m.version).toBe(1);
    const triage = m.capabilities.find((c) => c.name === 'ticket_triage')!;
    expect(triage).toMatchObject({ title: 'Triage', resource: 'ticket', ui: 'ui://test/ticket.html' });
    expect(triage.input_schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'assignee']) as unknown });
    expect(triage.output_schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['resource', 'state', 'data']) as unknown });
    expect(m.capabilities.map((c) => c.name)).toEqual(kit.list().map((c) => c.name));
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);   // JSON-safe
  });
  it('carries kind and annotations per capability', () => {
    const m = manifestOf(kit);
    const close = m.capabilities.find((c) => c.name === 'ticket_close')!;
    expect(close.kind).toBe('transition');
    expect(close.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
    const get = m.capabilities.find((c) => c.name === 'ticket_get')!;
    expect(get.kind).toBe('load');
    expect(get.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  });
  it('a manifest without annotations (older server) still parses and defaults them to false/false', () => {
    const m = manifestOf(kit);
    const stripped = { ...m, capabilities: m.capabilities.map(({ kind: _k, annotations: _a, ...rest }) => rest) };
    const remote = createRemoteKit({ manifest: stripped, call: () => Promise.reject(new Error('unused')) });
    expect(remote.get('ticket_close')!.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
  });

  it('round-trips a remote kit built from the manifest (Standard JSON Schemas are passed through, not re-serialized)', () => {
    const m = manifestOf(kit);
    const remote = createRemoteKit({ manifest: m, call: () => Promise.reject(new Error('unused')) });
    expect(manifestOf(remote)).toEqual(m);
  });
});
