/**
 * Spec §3.9 through the admin assistant: a manager drafts, tests, approves, and runs a pattern
 * against a vendor API through @de_canter/apogee-agent tools, then the vendor breaks, the run is dead-lettered,
 * and replaying it succeeds once the vendor recovers; an inbound courier webhook is classified.
 */
import { createHmac } from 'node:crypto';
import { createAgentSession, type AgentEvent } from '@de_canter/apogee-agent';
import { createFakeModelClient, type FakeTurn, type GenerateRequest } from '@de_canter/apogee-ai';
import { isoDate, ref } from '@de_canter/apogee-kernel';
import { definePrompt, text } from '@de_canter/apogee-prompts';
import { describe, expect, it } from 'vitest';
import { createInMemoryExecutionAudit } from '../audit';
import { receiveWebhook } from '../inbound';
import { createInMemoryPatternStore, definePattern } from '../pattern';
import { createCircuitBreaker, createInMemoryDeadLetterQueue } from '../resilience';
import { integrationTools } from '../tools';
import { createInMemoryVault } from '../vault';

const now = () => isoDate('2026-09-19T12:00:00Z');
interface AdminCtx { manager: string; yard: { city: string } }

describe('acceptance: draft, test, approve, run, break, replay, and an inbound classification', () => {
  it('round-trips a pattern through the admin tools and the resilience path', async () => {
    let vendorDown = false;
    const fetchFn = ((url: string) => {
      if (vendorDown) return Promise.resolve(new Response('busy', { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ current: { temp_c: 21.5, condition: { text: 'Sunny' } }, url }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as unknown as typeof fetch;
    const vault = createInMemoryVault({ now });
    await vault.set('mock_api_key', 'demo-key-123');
    const store = createInMemoryPatternStore();
    const audit = createInMemoryExecutionAudit({ now });
    const deadLetters = createInMemoryDeadLetterQueue({ now });
    const breaker = createCircuitBreaker({ failureThreshold: 3 });
    const tools = integrationTools<AdminCtx>({ store, vault, deps: { fetch: fetchFn, audit, deadLetters, breaker, engine: { now }, sleep: () => Promise.resolve() }, actorFromCtx: (c) => ref('User', c.manager) });

    // The admin assistant, scripted: each user message becomes one tool call, then a sentence.
    const script = (req: GenerateRequest): FakeTurn => {
      const last = req.messages[req.messages.length - 1]!;
      if (typeof last.content !== 'string') return { text: 'Done.' };
      const m = last.content;
      if (m.startsWith('create')) return { toolUses: [{ id: 't1', name: 'create_integration_pattern', input: { pattern: { id: 'YARD_WEATHER', name: 'Yard weather', direction: 'outbound', variables: { baseUrl: 'https://api.mock.apogee.build' }, request: { method: 'GET', urlTemplate: '{{vars.baseUrl}}/weather?city={{ctx.yard.city}}', retries: { max: 1, backoffMs: 100, retryOn: [503] } }, auth: { method: 'api_key', vaultKey: 'mock_api_key', config: { placement: 'query', name: 'key' } }, response: { mapping: [{ source: 'current.temp_c', target: 'tempC' }] } } } }] };
      if (m.startsWith('test')) return { toolUses: [{ id: 't2', name: 'test_integration_pattern', input: { id: 'YARD_WEATHER' } }] };
      if (m.startsWith('approve')) return { toolUses: [{ id: 't3', name: 'approve_integration_pattern', input: { id: 'YARD_WEATHER' } }] };
      if (m.startsWith('run')) return { toolUses: [{ id: 't4', name: 'run_integration_pattern', input: { id: 'YARD_WEATHER' } }] };
      if (m.startsWith('replay')) return { toolUses: [{ id: 't5', name: 'replay_dead_letter', input: { id: m.split(' ')[1]! } }] };
      return { text: 'Done.' };
    };
    const client = createFakeModelClient(script);
    const session = createAgentSession<AdminCtx>({ sessionId: 'admin', client, prompt: definePrompt<AdminCtx>({ name: 'a', version: '1.0.0', sections: [text('id', 'You administer integrations.')] }), tools, ctx: { manager: 'jeff', yard: { city: 'Austin' } } });
    const turn = async (message: string): Promise<AgentEvent[]> => {
      const events: AgentEvent[] = [];
      for await (const e of session.run(message)) events.push(e);
      return events;
    };
    const toolResult = (events: AgentEvent[]) => events.find((e) => e.type === 'tool_result');

    await turn('create the yard weather pattern');
    expect((await store.get('YARD_WEATHER'))?.status).toBe('draft');
    const tested = toolResult(await turn('test it'));
    expect(tested?.type === 'tool_result' && tested.result.artifact?.type).toBe('integration-test-card');
    expect(JSON.stringify(tested)).not.toContain('demo-key-123');
    await turn('approve it');
    expect((await store.get('YARD_WEATHER'))?.approvedBy).toEqual({ kind: 'User', id: 'jeff' });
    const ran = toolResult(await turn('run it'));
    expect(ran?.type === 'tool_result' && ran.result.success).toBe(true);
    expect(ran?.type === 'tool_result' && (ran.result.data as { output: unknown }).output).toEqual({ tempC: 21.5 });

    vendorDown = true;
    const failed = toolResult(await turn('run it again'));
    expect(failed?.type === 'tool_result' && failed.result.success).toBe(false);
    const pending = (await deadLetters.list({ status: 'pending' })).entries;
    expect(pending).toHaveLength(1);
    expect(breaker.state('YARD_WEATHER').consecutiveFailures).toBe(1);

    vendorDown = false;
    const replayed = toolResult(await turn(`replay ${pending[0]!.id}`));
    expect(replayed?.type === 'tool_result' && replayed.result.success).toBe(true);
    expect((await deadLetters.get(pending[0]!.id))?.status).toBe('replayed');
    expect((await audit.health('YARD_WEATHER'))[0]).toMatchObject({ success: 2, failure: 1 });

    // Inbound: a courier webhook, signed, classified by the model at high confidence.
    await store.upsert({ ...definePattern({ id: 'COURIER_NOTE', name: 'Courier note', description: 'Free-form courier updates', direction: 'inbound', inbound: { mapping: [{ source: 'note', target: 'note' }] } }, now), status: 'active', approvedBy: ref('User', 'jeff') });
    await vault.set('courier_hmac', 'shh');
    const payload = JSON.stringify({ note: 'Driver running late' });
    const inbound = await receiveWebhook(
      { sender: { id: 'courier', auth: { method: 'hmac', vaultKey: 'courier_hmac' } }, headers: { 'x-signature': createHmac('sha256', 'shh').update(payload).digest('hex') }, rawBody: payload },
      { patterns: store, vault, audit, deadLetters, engine: { now, client: createFakeModelClient([{ object: { patternId: 'COURIER_NOTE', confidence: 0.96, reasoning: 'A courier note.' } }]) } },
    );
    expect(inbound).toMatchObject({ action: 'classified', patternId: 'COURIER_NOTE', output: { note: 'Driver running late' } });
    expect(inbound.classification?.assertion.status).toBe('proposed');
  });
});
