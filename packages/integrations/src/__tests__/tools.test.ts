import { createToolRegistry, type ToolResult } from '@apogee/agent';
import { isoDate, ref } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { createInMemoryExecutionAudit } from '../audit';
import { createInMemoryPatternStore, definePattern } from '../pattern';
import { createCircuitBreaker, createInMemoryDeadLetterQueue, createRateLimiter } from '../resilience';
import { integrationTools } from '../tools';
import { createInMemoryVault } from '../vault';

const now = () => isoDate('2026-09-19T12:00:00Z');
interface Ctx { manager: string; yard: { city: string } }
const body = { current: { temp_c: 21.5 } };

function setup(responses: Array<() => Response>) {
  const calls: string[] = [];
  const fetchFn = ((url: string) => {
    calls.push(url);
    const next = responses.length > 1 ? responses.shift() : responses[0];
    return Promise.resolve(next ? next() : new Response('gone', { status: 503 }));
  }) as unknown as typeof fetch;
  const vault = createInMemoryVault({ now });
  const store = createInMemoryPatternStore([
    definePattern({ id: 'YARD_WEATHER', name: 'Yard weather', description: 'Weather at a yard', direction: 'outbound', variables: { baseUrl: 'https://api.mock.apogee.build' }, request: { method: 'GET', urlTemplate: '{{vars.baseUrl}}/weather?city={{ctx.yard.city}}', retries: { max: 0, backoffMs: 100, retryOn: [] } }, auth: { method: 'api_key', vaultKey: 'mock_api_key', config: { placement: 'query', name: 'key' } }, response: { mapping: [{ source: 'current.temp_c', target: 'tempC' }] } }, now),
  ]);
  const audit = createInMemoryExecutionAudit({ now });
  const deadLetters = createInMemoryDeadLetterQueue({ now });
  const breaker = createCircuitBreaker({ failureThreshold: 1 });
  const changes: number[] = [];
  const tools = integrationTools<Ctx>({ store, vault, deps: { fetch: fetchFn, audit, deadLetters, breaker, limiter: createRateLimiter(), engine: { now }, sleep: () => Promise.resolve() }, actorFromCtx: (c) => ref('User', c.manager), onChange: () => changes.push(1) });
  const registry = createToolRegistry(tools);
  const context = { ctx: { manager: 'jeff', yard: { city: 'Austin' } }, toolUseId: 'tu1', sessionId: 's1' };
  const call = (name: string, input: unknown): Promise<ToolResult> => registry.get(name)!.execute(input as never, context);
  return { call, registry, store, vault, audit, deadLetters, breaker, calls, changes };
}
const json = (status: number, b: unknown) => () => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('integrationTools', () => {
  it('exposes the admin tool set', () => {
    const { registry } = setup([]);
    expect(registry.definitions().map((d) => d.name).sort()).toEqual([
      'approve_integration_pattern', 'create_integration_pattern', 'list_dead_letters', 'list_integration_patterns', 'manage_credentials', 'pause_integration_pattern', 'replay_dead_letter',
      'reset_circuit_breaker', 'resume_integration_pattern', 'run_integration_pattern', 'show_integration_health', 'show_integration_trace', 'test_integration_pattern', 'update_integration_pattern',
    ]);
  });

  it('lists, creates drafts with human provenance, and updates', async () => {
    const { call, store } = setup([]);
    const listed = await call('list_integration_patterns', {});
    expect(listed.artifacts).toMatchObject([{ type: 'integration-pattern-card', data: { id: 'YARD_WEATHER', status: 'draft' } }]);
    const created = await call('create_integration_pattern', { pattern: { id: 'GEOCODE', name: 'Geocode', direction: 'outbound', request: { method: 'GET', urlTemplate: 'https://api.mock.apogee.build/geocode?q={{ctx.yard.city}}' } } });
    expect(created.success).toBe(true);
    expect((await store.get('GEOCODE'))?.provenance).toMatchObject({ source: { kind: 'human', ref: { kind: 'User', id: 'jeff' } } });
    const bad = await call('create_integration_pattern', { pattern: { id: 'bad-id', name: 'x', direction: 'outbound' } });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain('id');
    const updated = await call('update_integration_pattern', { id: 'GEOCODE', patch: { description: 'Lat and lon' } });
    expect(updated.success).toBe(true);
    expect((await store.get('GEOCODE'))?.version).toBe(2);
    expect((await call('update_integration_pattern', { id: 'NOPE', patch: {} })).success).toBe(false);
  });

  it('dry-runs with masked secrets, approves, pauses, resumes, and refuses unapproved resumes', async () => {
    const { call, vault, changes } = setup([]);
    await vault.set('mock_api_key', 'demo-key-123');
    const draftRun = await call('run_integration_pattern', { id: 'YARD_WEATHER' });
    expect(draftRun.success).toBe(false);
    const test = await call('test_integration_pattern', { id: 'YARD_WEATHER' });
    expect(test.success).toBe(true);
    expect(test.artifact).toMatchObject({ type: 'integration-test-card', data: { status: 'dry_run', request: { url: 'https://api.mock.apogee.build/weather?[redacted]' } } });
    expect(JSON.stringify(test)).not.toContain('demo-key-123');
    expect(await call('pause_integration_pattern', { id: 'YARD_WEATHER' })).toMatchObject({ success: false });
    expect(await call('approve_integration_pattern', { id: 'YARD_WEATHER' })).toMatchObject({ success: true, artifact: { data: { status: 'active', approvedBy: { id: 'jeff' } } } });
    expect(await call('pause_integration_pattern', { id: 'YARD_WEATHER' })).toMatchObject({ success: true });
    expect(await call('resume_integration_pattern', { id: 'YARD_WEATHER' })).toMatchObject({ success: true });
    expect(changes.length).toBe(3);
  });

  it('runs, traces, reports health, dead-letters, replays, and resets the breaker', async () => {
    const { call, vault, deadLetters, breaker, calls } = setup([json(503, {}), json(200, body)]);
    await vault.set('mock_api_key', 'demo-key-123');
    await call('approve_integration_pattern', { id: 'YARD_WEATHER' });
    const failed = await call('run_integration_pattern', { id: 'YARD_WEATHER' });
    expect(failed.success).toBe(false);
    expect(failed.artifact).toMatchObject({ type: 'integration-trace-card', data: { status: 'failure', attempts: 1 } });
    const traceId = (failed.data as { traceId: string }).traceId;
    expect(await call('show_integration_trace', { traceId })).toMatchObject({ success: true, data: { status: 'failure' } });
    expect(await call('show_integration_trace', { traceId: 'nope' })).toMatchObject({ success: false });
    const dl = await call('list_dead_letters', { source: 'outbound_failure' });
    const entries = (dl.data as { entries: Array<{ id: string }> }).entries;
    expect(entries).toHaveLength(1);
    expect(breaker.state('YARD_WEATHER').state).toBe('open');
    expect(await call('reset_circuit_breaker', { id: 'YARD_WEATHER' })).toMatchObject({ success: true });
    const replay = await call('replay_dead_letter', { id: entries[0]!.id });
    expect(replay).toMatchObject({ success: true, data: { status: 'replayed' } });
    expect(calls).toHaveLength(2);
    expect((await deadLetters.get(entries[0]!.id))?.status).toBe('replayed');
    const health = await call('show_integration_health', {});
    expect((health.data as { health: Array<{ patternId: string; total: number }> }).health[0]).toMatchObject({ patternId: 'YARD_WEATHER', total: 2 });
    expect(await call('replay_dead_letter', { id: 'nope' })).toMatchObject({ success: false });
  });

  it('manages credentials without echoing values', async () => {
    const { call, vault } = setup([]);
    const set = await call('manage_credentials', { action: 'set', key: 'mock_api_key', value: 'demo-key-123', name: 'Mock key' });
    expect(set.success).toBe(true);
    expect(JSON.stringify(set)).not.toContain('demo-key-123');
    expect(await vault.get('mock_api_key')).toBe('demo-key-123');
    expect((await call('manage_credentials', { action: 'list' })).data).toMatchObject({ credentials: [{ key: 'mock_api_key', active: true }] });
    expect(await call('manage_credentials', { action: 'rotate', key: 'mock_api_key', value: 'demo-key-456' })).toMatchObject({ success: true });
    expect(await vault.get('mock_api_key')).toBe('demo-key-456');
    expect(await call('manage_credentials', { action: 'rotate', key: 'nope', value: 'x' })).toMatchObject({ success: false });
    expect(await call('manage_credentials', { action: 'set', key: 'nope' })).toMatchObject({ success: false });
    expect(await call('manage_credentials', { action: 'remove', key: 'mock_api_key' })).toMatchObject({ success: true });
    expect(await vault.get('mock_api_key')).toBeUndefined();
  });
});
