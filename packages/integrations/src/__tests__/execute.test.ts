import { AiError, createFakeModelClient } from '@de_canter/apogee-ai';
import { isoDate, ref } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { createInMemoryExecutionAudit } from '../audit';
import { buildRequest, executePattern, type ExecuteDeps } from '../execute';
import { approvePattern, definePattern, type IntegrationPattern } from '../pattern';
import { createCircuitBreaker, createInMemoryDeadLetterQueue, createRateLimiter, fingerprint } from '../resilience';
import { createInMemoryVault } from '../vault';

const now = () => isoDate('2026-09-19T12:00:00Z');
const jeff = ref('User', 'jeff');

const weather = (over: Partial<IntegrationPattern> = {}): IntegrationPattern =>
  approvePattern(
    definePattern(
      {
        id: 'YARD_WEATHER', name: 'Yard weather', direction: 'outbound',
        variables: { baseUrl: 'https://api.mock.apogee.build' },
        request: { method: 'GET', urlTemplate: '{{vars.baseUrl}}/weather?city={{ctx.yard.city}}', headers: { Accept: 'application/json' }, retries: { max: 2, backoffMs: 100, retryOn: [503] } },
        auth: { method: 'api_key', vaultKey: 'mock_api_key', config: { placement: 'query', name: 'key' } },
        response: { mapping: [{ source: 'current.temp_c', target: 'weather.tempC', transform: 'to_number' }, { source: 'current.condition.text', target: 'weather.condition' }] },
        ...over,
      },
      now,
    ),
    jeff,
    now(),
  );

interface Call { url: string; init: RequestInit }
function fakeFetch(responses: Array<() => Response | Error>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    const r = next ? next() : new Error('script exhausted');
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const body = { current: { temp_c: '21.5', condition: { text: 'Sunny' } } };

async function deps(responses: Array<() => Response | Error>, extra: Partial<ExecuteDeps> = {}) {
  const vault = createInMemoryVault();
  await vault.set('mock_api_key', 'demo-key-123');
  const ff = fakeFetch(responses);
  const sleeps: number[] = [];
  const d: ExecuteDeps = { fetch: ff.fetch, vault, audit: createInMemoryExecutionAudit({ now }), deadLetters: createInMemoryDeadLetterQueue({ now }), breaker: createCircuitBreaker({ failureThreshold: 2 }), limiter: createRateLimiter(), sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }, jitter: () => 1, engine: { now, clock: (() => { let t = 0; return () => (t += 5); })() }, ...extra };
  return { d, calls: ff.calls, sleeps, vault };
}
const ctx = { yard: { city: 'Austin', name: 'north' } };

describe('buildRequest', () => {
  it('interpolates, resolves the vault, injects auth, and adds the trace header', async () => {
    const { d } = await deps([]);
    const req = await buildRequest(weather(), { ctx }, { vault: d.vault, traceId: 'trace-1' });
    expect(req.url).toBe('https://api.mock.apogee.build/weather?city=Austin&key=demo-key-123');
    expect(req.headers).toMatchObject({ Accept: 'application/json', 'X-Request-Id': 'trace-1' });
    expect(req.timeoutMs).toBe(30_000);
    expect(req.vaultKeys).toEqual(['mock_api_key']);
  });
  it('interpolates JSON bodies and resolves vault references inside them', async () => {
    const { d } = await deps([]);
    const p = weather({ request: { method: 'POST', urlTemplate: '{{vars.baseUrl}}/x', headers: { 'content-type': 'application/json' }, bodyTemplate: '{"city":"{{ctx.yard.city}}","token":"{{vault:mock_api_key}}"}', timeoutMs: 5000, retries: { max: 0, backoffMs: 100, maxBackoffMs: 100, retryOn: [] } }, auth: undefined });
    const req = await buildRequest(p, { ctx }, { vault: d.vault, traceId: 't' });
    expect(req.body).toBe('{"city":"Austin","token":"demo-key-123"}');
    expect(req.vaultKeys).toEqual(['mock_api_key']);
  });
});

describe('executePattern', () => {
  it('succeeds, maps, audits with redaction, and calls onOutput', async () => {
    const outputs: unknown[] = [];
    const { d, calls } = await deps([json(200, body)], { onOutput: (o) => { outputs.push(o); } });
    const r = await executePattern(weather(), { ctx, subject: ref('Yard', 'north'), traceId: 'trace-1' }, d);
    expect(r).toMatchObject({ traceId: 'trace-1', status: 'success', success: true, statusCode: 200, attempts: 1, aiProcessed: false, output: { weather: { tempC: 21.5, condition: 'Sunny' } } });
    expect(r.drift).toEqual({ drifted: false, fingerprint: fingerprint(body) });
    expect(calls[0]!.url).toContain('key=demo-key-123');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Request-Id']).toBe('trace-1');
    expect(outputs).toEqual([{ weather: { tempC: 21.5, condition: 'Sunny' } }]);
    const audited = (await d.audit!.get('trace-1'))!;
    expect(audited).toMatchObject({ status: 'success', patternId: 'YARD_WEATHER', subject: { kind: 'Yard', id: 'north' }, response: { status: 200, output: { weather: { tempC: 21.5 } } } });
    expect(audited.request?.url).toBe('https://api.mock.apogee.build/weather?[redacted]');
    expect(JSON.stringify(audited)).not.toContain('demo-key-123');
  });

  it('dry runs without fetching and masks the request', async () => {
    const { d, calls } = await deps([json(200, body)]);
    const r = await executePattern(weather(), { ctx, dryRun: true }, d);
    expect(r.status).toBe('dry_run');
    expect(calls).toHaveLength(0);
    expect(r.request?.url).toBe('https://api.mock.apogee.build/weather?[redacted]');
    expect(r.trigger?.matched).toBe(true);
    expect((await d.audit!.list({ status: 'dry_run' })).total).toBe(1);
  });

  it('retries listed statuses and reports attempts', async () => {
    const { d, sleeps } = await deps([json(503, {}), json(200, body)]);
    const r = await executePattern(weather(), { ctx }, d);
    expect(r).toMatchObject({ status: 'success', attempts: 2 });
    expect(sleeps).toEqual([100]);
  });

  it('fails after the retries, dead-letters, and counts a breaker failure', async () => {
    const { d, calls } = await deps([json(503, { msg: 'busy' })]);
    const r = await executePattern(weather(), { ctx }, d);
    expect(r).toMatchObject({ status: 'failure', success: false, statusCode: 503, attempts: 3, error: 'HTTP 503' });
    expect(calls).toHaveLength(3);
    const dl = (await d.deadLetters!.list({ source: 'outbound_failure' })).entries[0]!;
    expect(dl.patternId).toBe('YARD_WEATHER');
    expect(JSON.stringify(dl)).not.toContain('demo-key-123');
    expect(d.breaker!.state('YARD_WEATHER').consecutiveFailures).toBe(1);
    expect((await d.audit!.list({ status: 'failure' })).entries[0]!.error).toBe('HTTP 503');
  });

  it('is blocked by an open breaker and by the rate limit', async () => {
    const { d, calls } = await deps([json(200, body)]);
    d.breaker!.failure('YARD_WEATHER');
    d.breaker!.failure('YARD_WEATHER');
    const open = await executePattern(weather(), { ctx }, d);
    expect(open).toMatchObject({ status: 'circuit_open', success: false, attempts: 0 });
    expect(calls).toHaveLength(0);
    d.breaker!.reset('YARD_WEATHER');
    const limited = await executePattern(weather({ rateLimits: { maxPerMinute: 1 } }), { ctx }, { ...d, limiter: (() => { const l = createRateLimiter(); l.record('YARD_WEATHER'); return l; })() });
    expect(limited.status).toBe('rate_limited');
    expect((await d.audit!.list({ status: 'circuit_open' })).total).toBe(1);
  });

  it('skips on trigger mismatch and refuses inactive patterns', async () => {
    const { d, calls } = await deps([json(200, body)]);
    const gated = weather({ trigger: { event: 'rental.created', conditions: [{ field: 'yard.name', operator: 'equals', value: 'south' }] } });
    expect((await executePattern(gated, { ctx, event: 'rental.created' }, d)).status).toBe('trigger_skip');
    const draft = await executePattern({ ...weather(), status: 'draft' }, { ctx }, d);
    expect(draft).toMatchObject({ status: 'failure', error: 'Pattern is draft' });
    expect(calls).toHaveLength(0);
    expect((await d.audit!.list()).total).toBe(1);
  });

  it('post-processes with the model when enabled and survives a model failure', async () => {
    const client = createFakeModelClient([{ object: { tempC: 22, condition: 'sunny' } }, { error: new AiError('boom', 'X') }]);
    const p = weather({ ai: { enabled: true, promptTemplate: 'Summarize the weather for {{ctx.yard.name}} as { tempC, condition }.', maxResponseChars: 500 }, response: { mode: 'sync', successCodes: [200], mapping: [{ source: 'tempC', target: 'weather.tempC' }] } });
    const { d } = await deps([json(200, body), json(200, body)], { engine: { client, now, domain: 'an equipment rental company' } });
    const ok = await executePattern(p, { ctx }, d);
    expect(ok).toMatchObject({ status: 'success', aiProcessed: true, output: { weather: { tempC: 22 } } });
    const user = client.calls[0]!.messages[0]!.content as string;
    expect(user).toContain('Summarize the weather for north');
    expect(user).toContain('"temp_c"');
    const degraded = await executePattern(p, { ctx }, d);
    expect(degraded).toMatchObject({ status: 'success', aiProcessed: false });
    expect(degraded.output).toEqual({});
    expect((await d.audit!.list({ status: 'success' })).entries[0]!.metadata?.['aiError']).toBe('boom');
  });

  it('detects drift against a stored fingerprint and reports it', async () => {
    const drifts: string[] = [];
    const { d } = await deps([json(200, { current: { temp_c: 21 } })], { onDrift: (p, fp) => { drifts.push(`${p.id}:${fp}`); } });
    const stored = weather({ drift: { fingerprint: fingerprint(body) } });
    const r = await executePattern(stored, { ctx }, d);
    expect(r.drift).toMatchObject({ drifted: true, fingerprint: fingerprint({ current: { temp_c: 21 } }) });
    expect(drifts).toHaveLength(1);
    expect((await d.deadLetters!.list({ source: 'schema_drift' })).total).toBe(1);
    expect((await d.audit!.list()).entries[0]!.drift).toBe(true);
  });

  it('fails before fetching when a vault key is missing', async () => {
    const { d, calls } = await deps([json(200, body)]);
    const r = await executePattern(weather({ auth: { method: 'api_key', vaultKey: 'other_key', config: {} } }), { ctx }, d);
    expect(r.status).toBe('failure');
    expect(r.error).toContain('other_key');
    expect(calls).toHaveLength(0);
  });
});
