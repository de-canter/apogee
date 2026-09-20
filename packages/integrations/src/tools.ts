import { defineTool, type AnyTool, type ArtifactDescriptor, type ToolResult } from '@apogee/agent';
import { nowIso, type Ref } from '@apogee/kernel';
import { z } from 'zod';
import { maskHeaders } from './auth';
import { IntegrationsError } from './errors';
import { executePattern, type ExecuteDeps, type ExecutionResult } from './execute';
import { approvePattern, definePattern, IntegrationPatternSchema, pausePattern, resumePattern, updatePattern, type IntegrationPattern, type PatternStore } from './pattern';
import type { DeadLetter } from './resilience';
import type { VaultPort } from './vault';

export interface IntegrationToolsOptions<TCtx> {
  store: PatternStore;
  vault: VaultPort;
  deps: Omit<ExecuteDeps, 'vault'>;
  actorFromCtx: (ctx: TCtx) => Ref;
  /** What templates interpolate against; default the agent context itself. */
  executionCtx?: (ctx: TCtx) => unknown;
  onChange?: () => void;
}

export const PATTERN_CARD = 'integration-pattern-card';
export const TEST_CARD = 'integration-test-card';
export const TRACE_CARD = 'integration-trace-card';

const fail = (error: string): ToolResult => ({ success: false, error });
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function patternSummary(p: IntegrationPattern): Record<string, unknown> {
  return {
    id: p.id, name: p.name, description: p.description, direction: p.direction, status: p.status, version: p.version,
    ...(p.approvedBy ? { approvedBy: p.approvedBy } : {}), ...(p.approvedAt !== undefined ? { approvedAt: p.approvedAt } : {}),
    trigger: p.trigger, variables: p.variables,
    ...(p.request ? { request: { method: p.request.method, urlTemplate: p.request.urlTemplate, headers: maskHeaders(p.request.headers), timeoutMs: p.request.timeoutMs, retries: p.request.retries } } : {}),
    ...(p.auth ? { auth: { method: p.auth.method, vaultKey: p.auth.vaultKey } } : {}),
    response: p.response, ai: { enabled: p.ai.enabled }, ...(p.inbound ? { inbound: p.inbound } : {}), rateLimits: p.rateLimits,
  };
}
const patternCard = (p: IntegrationPattern, toolUseId: string): ArtifactDescriptor => ({ type: PATTERN_CARD, id: `pattern-${p.id}-${toolUseId}`, data: patternSummary(p) });
const resultData = (r: ExecutionResult): Record<string, unknown> => ({
  traceId: r.traceId, status: r.status, success: r.success, attempts: r.attempts, latencyMs: r.latencyMs, aiProcessed: r.aiProcessed,
  ...(r.statusCode !== undefined ? { statusCode: r.statusCode } : {}), ...(r.output ? { output: r.output } : {}), ...(r.error !== undefined ? { error: r.error } : {}),
  ...(r.request ? { request: r.request } : {}), ...(r.trigger ? { trigger: r.trigger } : {}), ...(r.drift ? { drift: r.drift } : {}),
});
const deadLetterData = (d: DeadLetter): Record<string, unknown> => ({ id: d.id, at: d.at, source: d.source, status: d.status, attempts: d.attempts, ...(d.patternId !== undefined ? { patternId: d.patternId } : {}), ...(d.error !== undefined ? { error: d.error } : {}) });

const PatternInput = IntegrationPatternSchema.omit({ provenance: true, status: true, version: true, approvedBy: true, approvedAt: true }).partial({ description: true, trigger: true, variables: true, response: true, ai: true, rateLimits: true, drift: true, metadata: true });
const IdInput = z.object({ id: z.string().min(1) });

/** The administrator's tool set for `@apogee/agent`: patterns, dry runs, approval, runs, traces, health, dead letters, the breaker, and credentials. */
export function integrationTools<TCtx>(opts: IntegrationToolsOptions<TCtx>): AnyTool<TCtx>[] {
  const { store, vault } = opts;
  const now = opts.deps.engine?.now ?? nowIso;
  const changed = (): void => opts.onChange?.();
  const execCtx = (ctx: TCtx): unknown => (opts.executionCtx ? opts.executionCtx(ctx) : ctx);
  const deps = (): ExecuteDeps => ({ ...opts.deps, vault });
  const load = async (id: string): Promise<IntegrationPattern | undefined> => store.get(id);

  const ListInput = z.object({ direction: z.enum(['outbound', 'inbound']).optional(), status: z.enum(['draft', 'active', 'paused']).optional(), search: z.string().optional() });
  const list = defineTool<TCtx, z.infer<typeof ListInput>>({
    name: 'list_integration_patterns',
    description: 'List integration patterns (outbound calls and inbound webhooks) with their status. Call it before changing one.',
    input: ListInput,
    async execute(input, { toolUseId }) {
      const patterns = await store.list({ ...(input.direction ? { direction: input.direction } : {}), ...(input.status ? { status: input.status } : {}), ...(input.search !== undefined ? { search: input.search } : {}) });
      return { success: true, message: `${patterns.length} pattern(s).`, data: patterns.map((p) => ({ id: p.id, name: p.name, direction: p.direction, status: p.status, version: p.version })), artifacts: patterns.map((p) => patternCard(p, toolUseId)) };
    },
  });

  const CreateInput = z.object({ pattern: z.record(z.string(), z.unknown()) });
  const create = defineTool<TCtx, z.infer<typeof CreateInput>>({
    name: 'create_integration_pattern',
    description: 'Create an integration pattern as a draft. Ids are UPPER_SNAKE_CASE. Templates use {{ctx.path}}, {{vars.name}}, and {{vault:key}}. A draft does nothing until approved.',
    input: CreateInput,
    async execute(input, { ctx, toolUseId }) {
      const parsed = PatternInput.safeParse(input.pattern);
      if (!parsed.success) return fail(`Invalid pattern: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      if (await load(parsed.data.id)) return fail(`Pattern ${parsed.data.id} already exists; use update_integration_pattern`);
      const pattern = definePattern({ ...parsed.data, provenance: { source: { kind: 'human', ref: opts.actorFromCtx(ctx) }, recordedAt: now() } }, now);
      await store.upsert(pattern);
      changed();
      return { success: true, message: `Draft ${pattern.id} created. Test it with test_integration_pattern, then approve it.`, data: patternSummary(pattern), artifact: patternCard(pattern, toolUseId) };
    },
  });

  const UpdateInput = z.object({ id: z.string().min(1), patch: z.record(z.string(), z.unknown()) });
  const update = defineTool<TCtx, z.infer<typeof UpdateInput>>({
    name: 'update_integration_pattern',
    description: 'Patch an existing pattern. Changing what it does (request, auth, response, inbound, variables, trigger) sends it back to draft for re-approval.',
    input: UpdateInput,
    async execute(input, { toolUseId }) {
      const existing = await load(input.id);
      if (!existing) return fail(`No pattern ${input.id}`);
      try {
        const next = updatePattern(existing, input.patch);
        await store.upsert(next);
        changed();
        return { success: true, message: `${next.id} is now version ${next.version} (${next.status}).`, data: patternSummary(next), artifact: patternCard(next, toolUseId) };
      } catch (e) {
        return fail(`Invalid patch: ${message(e)}`);
      }
    },
  });

  const RunInput = z.object({ id: z.string().min(1), event: z.string().optional() });
  const test = defineTool<TCtx, z.infer<typeof RunInput>>({
    name: 'test_integration_pattern',
    description: 'Dry-run a pattern: builds the request (secrets masked) and evaluates the trigger without calling the vendor.',
    input: RunInput,
    async execute(input, { ctx, toolUseId }) {
      const pattern = await load(input.id);
      if (!pattern) return fail(`No pattern ${input.id}`);
      const r = await executePattern({ ...pattern, status: 'active' }, { ctx: execCtx(ctx), dryRun: true, ...(input.event !== undefined ? { event: input.event } : {}) }, deps());
      const data = resultData(r);
      return { success: r.status === 'dry_run' || r.status === 'trigger_skip', message: r.status === 'dry_run' ? `Dry run of ${pattern.id}: ${r.request?.method ?? ''} ${r.request?.url ?? ''}` : `Dry run of ${pattern.id}: ${r.error ?? r.status}`, data, artifact: { type: TEST_CARD, id: `test-${pattern.id}-${toolUseId}`, data } };
    },
  });

  const approve = defineTool<TCtx, z.infer<typeof IdInput>>({
    name: 'approve_integration_pattern',
    description: 'Activate a draft or paused pattern, recording who approved it. Only when the administrator has explicitly approved.',
    input: IdInput,
    async execute(input, { ctx, toolUseId }) {
      const pattern = await load(input.id);
      if (!pattern) return fail(`No pattern ${input.id}`);
      const next = approvePattern(pattern, opts.actorFromCtx(ctx), now());
      await store.upsert(next);
      changed();
      return { success: true, message: `${next.id} is active (version ${next.version}).`, data: patternSummary(next), artifact: patternCard(next, toolUseId) };
    },
  });

  const lifecycle = (name: string, description: string, fn: (p: IntegrationPattern) => IntegrationPattern): AnyTool<TCtx> =>
    defineTool<TCtx, z.infer<typeof IdInput>>({
      name,
      description,
      input: IdInput,
      async execute(input, { toolUseId }) {
        const pattern = await load(input.id);
        if (!pattern) return fail(`No pattern ${input.id}`);
        try {
          const next = fn(pattern);
          await store.upsert(next);
          changed();
          return { success: true, message: `${next.id} is ${next.status}.`, data: patternSummary(next), artifact: patternCard(next, toolUseId) };
        } catch (e) {
          return fail(message(e));
        }
      },
    });
  const pause = lifecycle('pause_integration_pattern', 'Pause an active pattern; runs are refused until it is resumed.', pausePattern);
  const resume = lifecycle('resume_integration_pattern', 'Resume a paused pattern. Only a pattern that was approved before can be resumed; otherwise approve it.', resumePattern);

  const run = defineTool<TCtx, z.infer<typeof RunInput>>({
    name: 'run_integration_pattern',
    description: 'Execute an active outbound pattern for the current context now: the real request, with retries, the circuit breaker, and the audit.',
    input: RunInput,
    async execute(input, { ctx, toolUseId }) {
      const pattern = await load(input.id);
      if (!pattern) return fail(`No pattern ${input.id}`);
      const r = await executePattern(pattern, { ctx: execCtx(ctx), ...(input.event !== undefined ? { event: input.event } : {}), label: 'integrations:run' }, deps());
      const data = resultData(r);
      return { success: r.success, message: r.success ? `${pattern.id} succeeded in ${r.attempts} attempt(s).` : `${pattern.id} ${r.status}: ${r.error ?? ''}`, ...(r.error !== undefined && !r.success ? { error: r.error } : {}), data, artifact: { type: TRACE_CARD, id: `trace-${r.traceId}-${toolUseId}`, data } };
    },
  });

  const TraceInput = z.object({ traceId: z.string().min(1) });
  const trace = defineTool<TCtx, z.infer<typeof TraceInput>>({
    name: 'show_integration_trace',
    description: 'Show one execution by trace id: request (masked), response preview, status, attempts, latency.',
    input: TraceInput,
    async execute(input, { toolUseId }) {
      const record = await opts.deps.audit?.get(input.traceId);
      if (!record) return fail(`No trace ${input.traceId}`);
      const data: Record<string, unknown> = { ...record };
      return { success: true, message: `${record.patternId} ${record.status} (${record.attempts} attempt(s), ${record.latencyMs} ms).`, data, artifact: { type: TRACE_CARD, id: `trace-${record.traceId}-${toolUseId}`, data } };
    },
  });

  const HealthInput = z.object({ id: z.string().optional() });
  const health = defineTool<TCtx, z.infer<typeof HealthInput>>({
    name: 'show_integration_health',
    description: 'Success rate, failures, breaker and rate-limit blocks, and latency per pattern over the last 24 hours.',
    input: HealthInput,
    async execute(input) {
      const summaries = (await opts.deps.audit?.health(input.id)) ?? [];
      const breaker = opts.deps.breaker;
      const breakers = breaker ? Object.fromEntries(summaries.map((s) => [s.patternId, breaker.state(s.patternId)])) : {};
      return { success: true, message: `${summaries.length} pattern(s) with executions.`, data: { health: summaries, breakers } };
    },
  });

  const DeadLetterListInput = z.object({ source: z.enum(['outbound_failure', 'inbound_unmatched', 'inbound_low_confidence', 'correlation_timeout', 'schema_drift']).optional(), status: z.enum(['pending', 'replayed', 'discarded']).optional() });
  const deadLetters = defineTool<TCtx, z.infer<typeof DeadLetterListInput>>({
    name: 'list_dead_letters',
    description: 'List dead letters: failed outbound runs, unmatched or low-confidence inbound payloads, drifted responses.',
    input: DeadLetterListInput,
    async execute(input) {
      if (!opts.deps.deadLetters) return fail('No dead-letter queue configured');
      const { entries, total } = await opts.deps.deadLetters.list({ ...(input.source ? { source: input.source } : {}), ...(input.status ? { status: input.status } : {}) });
      return { success: true, message: `${total} dead letter(s).`, data: { total, entries: entries.map(deadLetterData) } };
    },
  });

  const replay = defineTool<TCtx, z.infer<typeof IdInput>>({
    name: 'replay_dead_letter',
    description: 'Re-run the pattern behind a dead letter with the context it failed with. Only when the administrator asks.',
    input: IdInput,
    async execute(input, { toolUseId }) {
      const queue = opts.deps.deadLetters;
      if (!queue) return fail('No dead-letter queue configured');
      const entry = await queue.get(input.id);
      if (!entry) return fail(`No dead letter ${input.id}`);
      let last: ExecutionResult | undefined;
      const done = await queue.replay(input.id, async (e) => {
        if (!e.patternId) throw new IntegrationsError('Dead letter has no pattern to replay', 'NO_PATTERN');
        const pattern = await load(e.patternId);
        if (!pattern) throw new IntegrationsError(`No pattern ${e.patternId}`, 'NO_PATTERN');
        const payload = e.payload as { ctx?: unknown; event?: string } | undefined;
        last = await executePattern(pattern, { ctx: payload?.ctx ?? {}, ...(payload?.event !== undefined ? { event: payload.event } : {}), label: 'integrations:replay' }, deps());
        if (!last.success) throw new IntegrationsError(last.error ?? last.status, 'REPLAY_FAILED');
      });
      const data = { ...deadLetterData(done), ...(last ? { execution: resultData(last) } : {}) };
      return done.status === 'replayed'
        ? { success: true, message: `Dead letter ${done.id} replayed successfully.`, data, ...(last ? { artifact: { type: TRACE_CARD, id: `trace-${last.traceId}-${toolUseId}`, data: resultData(last) } } : {}) }
        : { success: false, error: done.error ?? 'Replay failed', data };
    },
  });

  const resetBreaker = defineTool<TCtx, z.infer<typeof IdInput>>({
    name: 'reset_circuit_breaker',
    description: 'Close an open circuit breaker for a pattern so runs are allowed again.',
    input: IdInput,
    execute(input) {
      if (!opts.deps.breaker) return Promise.resolve(fail('No circuit breaker configured'));
      opts.deps.breaker.reset(input.id);
      return Promise.resolve({ success: true, message: `Circuit breaker for ${input.id} reset.`, data: opts.deps.breaker.state(input.id) as unknown as Record<string, unknown> });
    },
  });

  const CredentialsInput = z.object({ action: z.enum(['list', 'set', 'rotate', 'remove']), key: z.string().regex(/^[a-z0-9_]+$/).optional(), value: z.string().optional(), name: z.string().optional(), type: z.string().optional() });
  const credentials = defineTool<TCtx, z.infer<typeof CredentialsInput>>({
    name: 'manage_credentials',
    description: 'List, set, rotate, or remove vault credentials that patterns reference as {{vault:key}}. A value passed here travels through this conversation; prefer entering secrets outside the chat when possible. Values are never shown back.',
    input: CredentialsInput,
    async execute(input) {
      try {
        switch (input.action) {
          case 'list':
            return { success: true, message: 'Credentials listed.', data: { credentials: await vault.list() } };
          case 'set': {
            if (input.key === undefined || input.value === undefined) return fail('set needs key and value');
            const meta = await vault.set(input.key, input.value, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.type !== undefined ? { type: input.type } : {}) });
            return { success: true, message: `Credential ${meta.key} stored.`, data: meta as unknown as Record<string, unknown> };
          }
          case 'rotate': {
            if (input.key === undefined || input.value === undefined) return fail('rotate needs key and value');
            const meta = await vault.rotate(input.key, input.value);
            return { success: true, message: `Credential ${meta.key} rotated.`, data: meta as unknown as Record<string, unknown> };
          }
          case 'remove': {
            if (input.key === undefined) return fail('remove needs key');
            const removed = await vault.remove(input.key);
            return removed ? { success: true, message: `Credential ${input.key} deactivated.` } : fail(`No credential ${input.key}`);
          }
        }
      } catch (e) {
        return fail(message(e));
      }
    },
  });

  return [list, create, update, test, approve, pause, resume, run, trace, health, deadLetters, replay, resetBreaker, credentials];
}
