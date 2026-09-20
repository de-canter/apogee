import { nowIso, type Ref } from '@apogee/kernel';
import { composePrompt, toSystemBlocks } from '@apogee/prompts';
import { getAuthMethod, maskHeaders, redactUrl, type OutboundRequest } from './auth';
import { preview, type ExecutionAuditSink, type ExecutionRecord, type ExecutionStatus } from './audit';
import { IntegrationsError } from './errors';
import { evaluateTrigger, type IntegrationPattern, type TriggerEvaluation } from './pattern';
import { DEFAULT_DOMAIN, POST_PROCESS_PROMPT, PostProcessOutputSchema, type IntegrationEngineOptions } from './prompts';
import { checkDrift, retry, type CircuitBreaker, type DeadLetterQueue, type RateLimiter } from './resilience';
import { findVaultRefs, interpolate, type InterpolationScope } from './template';
import { applyMapping } from './transforms';
import { resolveVaultRefs, type VaultPort } from './vault';

export interface ExecuteDeps {
  fetch?: typeof fetch;
  vault: VaultPort;
  audit?: ExecutionAuditSink;
  limiter?: RateLimiter;
  breaker?: CircuitBreaker;
  deadLetters?: DeadLetterQueue;
  engine?: IntegrationEngineOptions;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
  /** Where mapped output goes; the host decides. */
  onOutput?: (output: Record<string, unknown>, ctx: unknown, pattern: IntegrationPattern) => Promise<void> | void;
  /** Called with the new fingerprint when a response's shape differs from the stored one. */
  onDrift?: (pattern: IntegrationPattern, fingerprint: string) => Promise<void> | void;
}

export interface ExecuteInput {
  /** What templates interpolate against. */
  ctx: unknown;
  subject?: Ref;
  event?: string;
  dryRun?: boolean;
  traceId?: string;
  label?: string;
}

export interface BuiltRequest extends OutboundRequest { timeoutMs: number; vaultKeys: string[] }

export const TRACE_HEADER = 'X-Request-Id';

/** Interpolate url, headers, and body against ctx, vars, and secrets; inject auth; add the trace header. */
export async function buildRequest(pattern: IntegrationPattern, input: ExecuteInput, deps: Pick<ExecuteDeps, 'vault' | 'fetch'> & { traceId: string; now?: () => number }): Promise<BuiltRequest> {
  const req = pattern.request;
  if (!req) throw new IntegrationsError(`Pattern ${pattern.id} has no request`, 'NO_REQUEST');
  const templates = [req.urlTemplate, ...Object.values(req.headers), ...(req.bodyTemplate !== undefined ? [req.bodyTemplate] : [])];
  const secrets = await resolveVaultRefs(deps.vault, templates);
  const vaultKeys = [...new Set(templates.flatMap(findVaultRefs))];
  const scope: InterpolationScope = { ctx: input.ctx, vars: pattern.variables, secrets };
  let built: OutboundRequest = {
    method: req.method,
    url: interpolate(req.urlTemplate, scope),
    headers: { ...Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, interpolate(v, scope)])), [TRACE_HEADER]: deps.traceId },
    ...(req.bodyTemplate !== undefined ? { body: interpolate(req.bodyTemplate, scope) } : {}),
  };
  if (pattern.auth) {
    const secret = await deps.vault.get(pattern.auth.vaultKey);
    if (secret === undefined) throw new IntegrationsError(`No vault entry ${pattern.auth.vaultKey}`, 'VAULT_MISSING');
    vaultKeys.push(pattern.auth.vaultKey);
    built = await getAuthMethod(pattern.auth.method).inject(built, secret, pattern.auth.config, { fetch: deps.fetch ?? globalThis.fetch, now: deps.now ?? (() => Date.now()) });
  }
  return { ...built, timeoutMs: req.timeoutMs, vaultKeys: [...new Set(vaultKeys)] };
}

export interface ExecutionResult {
  traceId: string;
  status: ExecutionStatus;
  success: boolean;
  statusCode?: number;
  data?: unknown;
  output?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
  attempts: number;
  aiProcessed: boolean;
  drift?: { drifted: boolean; fingerprint?: string };
  /** Masked; only on a dry run. */
  request?: { method: string; url: string; headers: Record<string, string>; body?: string };
  trigger?: TriggerEvaluation;
}

const masked = (r: OutboundRequest): { method: string; url: string; headers: Record<string, string>; body?: string } => ({ method: r.method, url: redactUrl(r.url), headers: maskHeaders(r.headers), ...(r.body !== undefined ? { body: r.body } : {}) });

async function readBody(res: Response): Promise<{ data: unknown; text: string }> {
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json') && text !== '') {
    try {
      return { data: JSON.parse(text) as unknown, text };
    } catch {
      return { data: text, text };
    }
  }
  return { data: text, text };
}

/** Run one outbound pattern: gates, build, dry run or fetch with retries, then drift, AI post-processing, mapping, output, audit. */
export async function executePattern(pattern: IntegrationPattern, input: ExecuteInput, deps: ExecuteDeps): Promise<ExecutionResult> {
  const engine = deps.engine ?? {};
  const now = engine.now ?? nowIso;
  const clock = engine.clock ?? (() => Date.now());
  const started = clock();
  const traceId = input.traceId ?? crypto.randomUUID();
  const audit = async (status: ExecutionStatus, extra: Partial<ExecutionRecord> = {}): Promise<void> => {
    if (!deps.audit) return;
    await deps.audit.record({ traceId, at: now(), patternId: pattern.id, direction: 'outbound', status, latencyMs: clock() - started, attempts: 0, aiProcessed: false, ...(input.subject ? { subject: input.subject } : {}), ...extra });
  };
  const done = (status: ExecutionStatus, extra: Partial<ExecutionResult> = {}): ExecutionResult => ({ traceId, status, success: status === 'success' || status === 'dry_run', latencyMs: clock() - started, attempts: 0, aiProcessed: false, ...extra });

  if (pattern.status !== 'active') return done('failure', { error: `Pattern is ${pattern.status}` });
  if (deps.breaker) {
    const gate = deps.breaker.check(pattern.id);
    if (!gate.allowed) {
      const error = `Circuit breaker ${gate.state} after ${gate.consecutiveFailures} consecutive failures`;
      await audit('circuit_open', { error });
      return done('circuit_open', { error });
    }
  }
  if (deps.limiter) {
    const gate = deps.limiter.check(pattern.id, pattern.rateLimits);
    if (!gate.allowed) {
      const error = `Rate limit exceeded; retry in ${Math.ceil((gate.retryAfterMs ?? 0) / 1000)}s`;
      await audit('rate_limited', { error });
      return done('rate_limited', { error });
    }
  }
  const trigger = evaluateTrigger(pattern, input.ctx, input.event);
  if (!trigger.matched) {
    await audit('trigger_skip', { error: 'Trigger conditions not met' });
    return done('trigger_skip', { error: 'Trigger conditions not met', trigger });
  }

  let built: BuiltRequest;
  try {
    built = await buildRequest(pattern, input, { vault: deps.vault, ...(deps.fetch ? { fetch: deps.fetch } : {}), traceId, now: clock });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await audit('failure', { error });
    return done('failure', { error });
  }
  const request = masked(built);
  if (input.dryRun) {
    await audit('dry_run', { request: { ...request, ...(built.body !== undefined ? { bodyPreview: preview(built.body) } : {}) } });
    return done('dry_run', { request, trigger });
  }

  deps.limiter?.record(pattern.id);
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const outcome = await retry(
    async () => {
      const res = await fetchFn(built.url, { method: built.method, headers: built.headers, ...(built.body !== undefined ? { body: built.body } : {}), signal: AbortSignal.timeout(built.timeoutMs) });
      const body = await readBody(res);
      return { status: res.status, value: body };
    },
    (status) => pattern.response.successCodes.includes(status),
    { ...pattern.request!.retries, ...(deps.sleep ? { sleep: deps.sleep } : {}), ...(deps.jitter ? { jitter: deps.jitter } : {}) },
  );
  const attempts = outcome.attempts.length;
  const requestRecord = { ...request, ...(built.body !== undefined ? { bodyPreview: preview(built.body) } : {}) };

  if (!outcome.ok) {
    const error = outcome.error ?? 'Request failed';
    deps.breaker?.failure(pattern.id);
    await deps.deadLetters?.enqueue({ source: 'outbound_failure', patternId: pattern.id, payload: { request, ctx: input.ctx, event: input.event }, error, metadata: { attempts, statusCode: outcome.status, traceId } });
    await audit('failure', { request: requestRecord, ...(outcome.status !== undefined ? { response: { status: outcome.status, ...(outcome.value ? { bodyPreview: preview(outcome.value.text) } : {}) } } : {}), error, attempts });
    return done('failure', { error, attempts, ...(outcome.status !== undefined ? { statusCode: outcome.status } : {}), ...(outcome.value ? { data: outcome.value.data } : {}) });
  }

  deps.breaker?.success(pattern.id);
  const data = outcome.value!.data;
  const drift = checkDrift(pattern, data);
  if (drift.drifted && drift.fingerprint !== undefined) {
    await deps.onDrift?.(pattern, drift.fingerprint);
    await deps.deadLetters?.enqueue({ source: 'schema_drift', patternId: pattern.id, payload: data, error: 'Response shape changed', metadata: { previous: drift.previous, fingerprint: drift.fingerprint, traceId } });
  }

  let processed: unknown = data;
  let aiProcessed = false;
  let aiError: string | undefined;
  if (pattern.ai.enabled && pattern.ai.promptTemplate !== undefined && engine.client) {
    try {
      const composed = await composePrompt(POST_PROCESS_PROMPT, { domain: engine.domain ?? DEFAULT_DOMAIN });
      const instructions = interpolate(pattern.ai.promptTemplate, { ctx: input.ctx, vars: pattern.variables });
      const bodyText = JSON.stringify(data, null, 2);
      const truncated = bodyText.length > pattern.ai.maxResponseChars ? `${bodyText.slice(0, pattern.ai.maxResponseChars)}\n…[truncated]` : bodyText;
      const { value } = await engine.client.generateObject(
        PostProcessOutputSchema,
        { model: engine.model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: `${instructions}\n\nREST API response:\n${truncated}` }], maxTokens: 2000 },
        { ...(input.label !== undefined ? { label: input.label } : {}) },
      );
      processed = value;
      aiProcessed = true;
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
    }
  }

  const output = applyMapping(processed, pattern.response.mapping);
  await deps.onOutput?.(output, input.ctx, pattern);
  await audit('success', {
    request: requestRecord,
    response: { ...(outcome.status !== undefined ? { status: outcome.status } : {}), bodyPreview: preview(outcome.value!.text), output },
    attempts,
    aiProcessed,
    drift: drift.drifted,
    ...(aiError !== undefined ? { metadata: { aiError } } : {}),
  });
  return done('success', { ...(outcome.status !== undefined ? { statusCode: outcome.status } : {}), data, output, attempts, aiProcessed, drift: { drifted: drift.drifted, ...(drift.fingerprint !== undefined ? { fingerprint: drift.fingerprint } : {}) }, trigger });
}
