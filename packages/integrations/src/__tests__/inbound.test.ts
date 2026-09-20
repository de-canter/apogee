import { createHmac } from 'node:crypto';
import { createFakeModelClient, type SystemBlock } from '@de_canter/apogee-ai';
import { isoDate, ref } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { createInMemoryExecutionAudit } from '../audit';
import { classifyInbound, createInMemoryCorrelationStore, matchInbound, receiveWebhook, verifySender, type InboundDeps, type SenderConfig } from '../inbound';
import { approvePattern, createInMemoryPatternStore, definePattern } from '../pattern';
import { createInMemoryDeadLetterQueue } from '../resilience';
import { createInMemoryVault } from '../vault';

const now = () => isoDate('2026-09-19T12:00:00Z');
const jeff = ref('User', 'jeff');
const active = (p: ReturnType<typeof definePattern>) => approvePattern(p, jeff, now());

const courier = active(definePattern({ id: 'DELIVERY_STATUS', name: 'Delivery status', description: 'Courier delivery updates', direction: 'inbound', inbound: { matchHeaders: { 'X-Source': 'courier' }, mapping: [{ source: 'status', target: 'delivery.status', transform: 'lowercase' }, { source: 'rental', target: 'rentalNumber' }], correlationField: 'requestId' } }, now));
const returns = active(definePattern({ id: 'RETURN_NOTICE', name: 'Return notice', description: 'A customer scheduled a return', direction: 'inbound', inbound: { matchBodyFields: { kind: 'return' }, mapping: [{ source: 'when', target: 'returnAt' }] } }, now));
const untyped = active(definePattern({ id: 'MISC', name: 'Misc events', description: 'Anything else the courier sends', direction: 'inbound', inbound: { mapping: [] } }, now));
const outbound = active(definePattern({ id: 'OUT', name: 'Out', direction: 'outbound' }, now));

const secret = 'courier-secret';
const sign = (body: string) => createHmac('sha256', secret).update(body).digest('hex');
const sender: SenderConfig = { id: 'courier', auth: { method: 'hmac', vaultKey: 'courier_hmac', config: { header: 'X-Signature' } }, ipAllowlist: ['10.0.0.1'] };
const systemText = (system: string | SystemBlock[] | undefined): string => (typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n'));

async function deps(extra: Partial<InboundDeps> = {}): Promise<InboundDeps> {
  const vault = createInMemoryVault();
  await vault.set('courier_hmac', secret);
  return { patterns: createInMemoryPatternStore([courier, returns, untyped, outbound]), vault, audit: createInMemoryExecutionAudit({ now }), deadLetters: createInMemoryDeadLetterQueue({ now }), correlations: createInMemoryCorrelationStore({ now }), engine: { now, domain: 'an equipment rental company' }, ...extra };
}
const body = JSON.stringify({ status: 'DELIVERED', rental: 'RA-2026007', requestId: 'req-1' });
const signed = (b: string, extra: Record<string, string> = {}) => ({ headers: { 'x-source': 'courier', 'x-signature': sign(b), 'content-type': 'application/json', authorization: 'Bearer leak-me', ...extra }, rawBody: b, sourceIp: '10.0.0.1' });
/** Signed, but without the header the courier pattern matches on. */
const unmatchedSigned = (b: string) => signed(b, { 'x-source': 'other' });

describe('verifySender', () => {
  it('checks the allowlist and the auth method', async () => {
    const d = await deps();
    expect(await verifySender(sender, signed(body), d.vault)).toEqual({ valid: true });
    expect((await verifySender(sender, { ...signed(body), headers: { 'x-signature': 'bad' } }, d.vault)).error).toContain('signature');
    expect((await verifySender(sender, { ...signed(body), sourceIp: '10.0.0.9' }, d.vault)).error).toContain('allowed');
    expect((await verifySender({ id: 'x', auth: { method: 'hmac', vaultKey: 'nope' } }, signed(body), d.vault)).error).toContain('nope');
    expect(await verifySender({ id: 'open' }, signed(body), d.vault)).toEqual({ valid: true });
  });
});

describe('matchInbound', () => {
  it('matches on headers and body fields, ignoring patterns without match config', () => {
    expect(matchInbound([courier, returns, untyped, outbound], { 'X-SOURCE': 'courier' }, { status: 'x' }).map((p) => p.id)).toEqual(['DELIVERY_STATUS']);
    expect(matchInbound([courier, returns, untyped], {}, { kind: 'return', when: '2026-09-26' }).map((p) => p.id)).toEqual(['RETURN_NOTICE']);
    expect(matchInbound([courier, returns, untyped], {}, { kind: 'other' })).toEqual([]);
  });
});

describe('classifyInbound', () => {
  it('asks the model with masked headers and a truncated payload and returns an assertion', async () => {
    const client = createFakeModelClient([{ object: { patternId: 'MISC', confidence: 0.96, reasoning: 'Free-form courier note.' }, usage: { input: 12 } }]);
    const r = await classifyInbound([courier, untyped], { authorization: 'Bearer leak-me', 'x-source': 'courier' }, { note: 'x'.repeat(3000) }, { client, now, domain: 'an equipment rental company' }, { maxPayloadChars: 100 });
    expect(r.pattern?.id).toBe('MISC');
    expect(r.confidence).toBe(0.96);
    expect(r.assertion).toMatchObject({ status: 'proposed', predicate: 'matches-pattern', object: { patternId: 'MISC', reasoning: 'Free-form courier note.' } });
    expect(r.assertion.provenance).toMatchObject({ source: { kind: 'ai', name: 'integrations.classify-inbound@1.0.0' }, confidence: 0.96 });
    expect(r.usage.input).toBe(12);
    const call = client.calls[0]!;
    expect(systemText(call.system)).toContain('equipment rental company');
    const user = call.messages[0]!.content as string;
    expect(user).toContain('- DELIVERY_STATUS: Delivery status — Courier delivery updates');
    expect(user).not.toContain('leak-me');
    expect(user).toContain('Bearer***');
    expect(user).toContain('[truncated]');
    const none = await classifyInbound([courier], {}, {}, { client: createFakeModelClient([{ object: { patternId: null, confidence: 0.1, reasoning: 'Nothing fits.' } }]), now });
    expect(none.pattern).toBeUndefined();
    const unknownId = await classifyInbound([courier], {}, {}, { client: createFakeModelClient([{ object: { patternId: 'GHOST', confidence: 0.99, reasoning: 'r' } }]), now });
    expect(unknownId.pattern).toBeUndefined();
  });
});

describe('createInMemoryCorrelationStore', () => {
  it('creates, matches on the field, completes, and expires', async () => {
    let t = 0;
    const store = createInMemoryCorrelationStore({ now: () => isoDate(`2026-09-19T12:${String(t).padStart(2, '0')}:00Z`) });
    const c = await store.create({ patternId: 'DELIVERY_STATUS', field: 'requestId', subject: ref('Rental', 'r1'), timeoutMs: 120_000, onTimeout: 'dead_letter' });
    expect(c).toMatchObject({ status: 'pending', expiresAt: '2026-09-19T12:02:00.000Z', onTimeout: 'dead_letter' });
    expect(await store.match({ requestId: 'nope' })).toBeUndefined();
    expect((await store.match({ requestId: c.id }, 'DELIVERY_STATUS'))?.id).toBe(c.id);
    expect((await store.match({ requestId: c.id }, 'OTHER'))).toBeUndefined();
    const done = await store.complete(c.id, { ok: true });
    expect(done).toMatchObject({ status: 'matched', payload: { ok: true } });
    expect(await store.match({ requestId: c.id })).toBeUndefined();
    const late = await store.create({ patternId: 'DELIVERY_STATUS', field: 'requestId', timeoutMs: 60_000, onTimeout: 'retry' });
    t = 5;
    expect((await store.expire()).map((x) => x.id)).toEqual([late.id]);
    expect((await store.list({ status: 'expired' })).length).toBe(1);
    expect(await store.cancel(late.id)).toBe(false);
  });
});

describe('receiveWebhook', () => {
  const base = (over: Partial<Parameters<typeof receiveWebhook>[0]> = {}) => ({ sender, ...signed(body), ...over });

  it('executes an explicitly named pattern, maps, audits, and calls onOutput', async () => {
    const outputs: unknown[] = [];
    const d = await deps({ onOutput: (o) => { outputs.push(o); } });
    const r = await receiveWebhook(base({ patternId: 'DELIVERY_STATUS', subject: ref('Rental', 'r1') }), d);
    expect(r).toMatchObject({ action: 'executed', patternId: 'DELIVERY_STATUS', output: { delivery: { status: 'delivered' }, rentalNumber: 'RA-2026007' } });
    expect(outputs).toHaveLength(1);
    const audited = (await d.audit!.list({ direction: 'inbound' })).entries[0]!;
    expect(audited).toMatchObject({ traceId: r.traceId, status: 'inbound', patternId: 'DELIVERY_STATUS', subject: { kind: 'Rental', id: 'r1' } });
    expect(JSON.stringify(audited)).not.toContain('leak-me');
  });

  it('matches deterministically before asking the model', async () => {
    const client = createFakeModelClient([]);
    const d = await deps({ engine: { client, now } });
    const r = await receiveWebhook(base(), d);
    expect(r.action).toBe('executed');
    expect(r.patternId).toBe('DELIVERY_STATUS');
    expect(client.calls).toHaveLength(0);
  });

  it('classifies with thresholds: auto, review, dead letter', async () => {
    const unmatched = JSON.stringify({ note: 'Driver called ahead' });
    const mk = (confidence: number) => deps({ engine: { client: createFakeModelClient([{ object: { patternId: 'MISC', confidence, reasoning: 'r' } }]), now } });
    const auto = await receiveWebhook(base({ ...unmatchedSigned(unmatched) }), await mk(0.97));
    expect(auto).toMatchObject({ action: 'classified', patternId: 'MISC', output: { note: 'Driver called ahead' } });
    expect(auto.classification?.assertion.status).toBe('proposed');
    const review = await receiveWebhook(base({ ...unmatchedSigned(unmatched) }), await mk(0.8));
    expect(review).toMatchObject({ action: 'needs_review', patternId: 'MISC' });
    expect(review.output).toBeUndefined();
    const low = await mk(0.5);
    const dead = await receiveWebhook(base({ ...unmatchedSigned(unmatched) }), low);
    expect(dead.action).toBe('dead_lettered');
    const dl = (await low.deadLetters!.list({ source: 'inbound_low_confidence' })).entries[0]!;
    expect(dl.metadata).toMatchObject({ confidence: 0.5 });
  });

  it('dead-letters unmatched payloads without a model and rejects bad requests', async () => {
    const d = await deps();
    const unmatched = JSON.stringify({ note: 'x' });
    const r = await receiveWebhook(base({ ...unmatchedSigned(unmatched) }), d);
    expect(r.action).toBe('dead_lettered');
    expect((await d.deadLetters!.list({ source: 'inbound_unmatched' })).total).toBe(1);
    const bad = await receiveWebhook(base({ headers: { 'x-source': 'courier', 'x-signature': 'bad' } }), d);
    expect(bad).toMatchObject({ action: 'rejected' });
    expect(bad.error).toContain('signature');
    const notJson = await receiveWebhook(base({ ...signed('not json') }), d);
    expect(notJson).toMatchObject({ action: 'rejected', error: expect.stringContaining('JSON') as string });
    const unknownExplicit = await receiveWebhook(base({ patternId: 'OUT' }), d);
    expect(unknownExplicit.action).toBe('rejected');
    expect((await d.audit!.list({ direction: 'inbound' })).total).toBe(4);
  });

  it('completes a pending correlation instead of mapping', async () => {
    const d = await deps();
    const c = await d.correlations!.create({ patternId: 'DELIVERY_STATUS', field: 'requestId', timeoutMs: 60_000, onTimeout: 'dead_letter' });
    const payload = JSON.stringify({ status: 'DELIVERED', requestId: c.id });
    const r = await receiveWebhook(base({ ...signed(payload) }), d);
    expect(r).toMatchObject({ action: 'correlated', correlationId: c.id, patternId: 'DELIVERY_STATUS' });
    expect((await d.correlations!.list({ status: 'matched' })).length).toBe(1);
  });

  it('limits candidates to the sender\'s patterns', async () => {
    const d = await deps();
    const r = await receiveWebhook(base({ sender: { ...sender, patternIds: ['RETURN_NOTICE'] } }), d);
    expect(r.action).toBe('dead_lettered');
  });
});
