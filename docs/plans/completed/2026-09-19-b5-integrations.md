# Plan B5 — `@apogee/integrations` + integration demo Implementation Plan

> **Outcome (2026-09-20):** Tasks 1–8 done in this repo on `feature/b5-integrations`, PR de-canter/apogee#16 (awaiting Jeff; tag `integrations-v0.1.0` after merge). 91 tests, 98.4% lines. Task 9 done in apogee-build on `feature/integrations-demo` (29 tests), with the tarball packed locally from the PR #16 commit. Deviations: the audit sink stamps `at` itself; `ExecutionResult` carries the trigger evaluation on dry runs; the dead-letter payload stores the masked request plus the context and event so replay can re-execute; the demo's inbound endpoint signs sample bodies server-side (`action: 'sign'`) because the courier is simulated; `deterministicConflicts`-style options were not needed here. Still on Jeff's list: merge both PRs, tag.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-09-19
**Origin:** `docs/design/ai-abstractions.md` §3.9, §5. Survey of the reference product (2026-09-19): `packages/shared/src/schemas/integration-pattern.ts`, `services/integration-engine/*` (execution engine, transforms, circuit breaker, rate limiter, schema drift, dead letter, execution audit, inbound webhooks, AI payload classifier, correlation), `services/integration-auth/*` (five auth methods), `services/credential-vault-service.ts`, `chat/tools/admin-integration-tools.ts`.

**Goal:** Ship `@apogee/integrations` v0.1.0: the `IntegrationPattern` schema and store port, `{{…}}` interpolation with vault references, the transform registry and response mapping, a `VaultPort` with AES-GCM helpers and the five auth methods (API key, basic, OAuth2 client credentials, HMAC, JWT bearer), resilience (sliding-window rate limit, circuit breaker, exponential retry, dead-letter queue with real replay, schema-drift fingerprints), `executePattern` with dry run, trace id propagation, AI post-processing and an execution audit with health, inbound webhooks with sender verification, deterministic matching, AI classification as an assertion and correlation, and an admin tool set for `@apogee/agent`. Then the apogee.build integration demo: author a pattern against an in-process mock geocoding and weather API, dry-run it, approve it, run it, break the API to watch retries, the breaker, the dead letter and its replay, and post a sample inbound payload to see it classified.

**Architecture:** Everything the engine touches is a port: `fetch` (the transport), `VaultPort`, `PatternStore`, `ExecutionAuditSink`, `DeadLetterQueue`, `RateLimiter`, `CircuitBreaker`, `CorrelationStore`, and the model client for the two AI steps. The engine itself is pure functions over a pattern and a host context: build the request (interpolate, resolve vault references, inject auth), run it through the resilience gates and the retry loop, map the response, record the trace. Inbound is the mirror: verify the sender, match a pattern deterministically or by classification, map the payload, or correlate it to a pending callback. Nothing in the package knows what an order, a task, or a vendor is; the host passes a context object and, if it wants, an `onOutput` hook to write mapped output somewhere.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, tsup; `@apogee/{kernel,ai,prompts,agent}` workspace deps; `node:crypto` for AES-GCM, HMAC, JWT HS256 and fingerprints; the standard `fetch` signature as the transport port. Demo: Next.js 16 in apogee-build.

**Spec:** `docs/design/ai-abstractions.md` §2, §3.9, §5.

## Global Constraints

- Package `packages/integrations` (`@apogee/integrations`), same toolchain as `packages/rules` (`exactOptionalPropertyTypes`: spread optional keys conditionally, derive tool input types from Zod).
- No network in tests: the transport is an injected `fetch`-compatible function returning `Response` objects; the model is `createFakeModelClient`.
- Domain vocabulary is injected: no pattern seeds, no entity names, no vendor URLs, no task categories ship in the package. The host's context object is what templates interpolate against; the host's `onOutput` decides where mapped output goes.
- AI output enters as an `Assertion`: the inbound classification (`predicate: 'matches-pattern'`) and, when a pattern enables it, AI post-processing results carry `Provenance` with `source.kind = 'ai'`.
- One model client; prompts registered as `integrations.classify-inbound@1.0.0` and `integrations.post-process@1.0.0`, with `domain` from the host.
- Secrets never appear in traces, dead letters, tool results, or prompts: headers are masked, query strings redacted, inbound headers redacted before classification (the survey found the reference product leaks them to the model).
- Deviations from the reference product, decided here: a `status` lifecycle (`draft` → `active` ⇄ `paused`) replaces the `active` boolean, and resume requires a prior approval; interpolation has explicit roots (`{{ctx.path}}`, `{{vars.name}}`, `{{vault:key}}`; a bare `{{path}}` reads `ctx`) so the unimplemented `{{baseUrl}}` becomes a pattern `variables` map; vault references resolve inside object bodies too; `inbound.match` is real (headers and body fields) and runs before classification; classification confidence is 0–1 with thresholds `dead-letter < 0.75 ≤ review < 0.95 ≤ auto`; dead-letter replay re-executes; the trace id goes out as `X-Request-Id`; inbound executions are audited; unknown transform names are an error, not a no-op; AI post-processing failures are recorded, not silently replaced by the raw body; the JWT method signs HS256 with `node:crypto` (RS256 is out of scope); the rate limiter and breaker are in-memory ports (adapters later).
- Branch `feature/b5-integrations`, commit per task, PR to `main`; after merge tag `integrations-v0.1.0`. Demo on apogee-build `feature/integrations-demo`, vendoring a locally packed tarball, PR to `main`.
- Definition of done per task: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` unfiltered at the root, gated on real exit codes; ≥ 90% lines.

## File Structure

```
packages/integrations/src/
├── index.ts
├── errors.ts         # IntegrationsError
├── pattern.ts        # IntegrationPatternSchema, definePattern, PatternStore + in-memory, lifecycle helpers, evaluateTrigger
├── template.ts       # interpolate, resolvePath, findVaultRefs, InterpolationScope
├── transforms.ts     # TRANSFORMS registry, applyTransform, applyMapping
├── vault.ts          # VaultPort, createInMemoryVault, encryptSecret/decryptSecret, resolveVaultRefs
├── auth.ts           # AuthMethod interface, five methods, getAuthMethod, jwt helpers, masking
├── resilience.ts     # createRateLimiter, createCircuitBreaker, retry, createDeadLetterQueue, fingerprint, checkDrift
├── audit.ts          # ExecutionRecord, ExecutionAuditSink + in-memory, healthSummary
├── prompts.ts        # IntegrationEngineOptions, CLASSIFY_INBOUND_PROMPT, POST_PROCESS_PROMPT, registry
├── execute.ts        # buildRequest, executePattern (outbound, dry run, AI post-processing)
├── inbound.ts        # verifySender, matchInbound, classifyInbound, CorrelationStore + in-memory, receiveWebhook
├── tools.ts          # integrationTools() for @apogee/agent
└── __tests__/ pattern, template, transforms, vault, auth, resilience, audit, execute, inbound, tools, acceptance

apogee-build/ (Task 9)
├── vendor/apogee-integrations-0.1.0.tgz; package.json
├── src/packages.ts                                       # integrations -> shipped, demo: /demo/integrations
├── src/demo/rental/integrations/{mock-api.ts,patterns.ts,server.ts,script.ts}
├── src/app/api/integrations/route.ts                      # GET state, POST { action } dispatcher
├── src/app/api/webhooks/[sender]/route.ts                 # inbound
├── src/app/demo/integrations/page.tsx, src/components/IntegrationsDemo.tsx
├── src/demo/rental/admin.ts                               # admin assistant gains the integration tools
└── src/__tests__/integrations.test.ts
```

---

### Task 1: Scaffold, pattern schema, store, trigger evaluation

**Files:** Create `packages/integrations/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts}` (copy from `packages/rules`; deps `@apogee/agent`, `@apogee/ai`, `@apogee/kernel`, `@apogee/prompts`, `zod`), `src/errors.ts`, `src/pattern.ts`, `src/index.ts`. Test `pattern.test.ts`.

**Interfaces:**
```ts
export class IntegrationsError extends Error { constructor(message: string, readonly code: string) }

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const AUTH_METHODS = ['api_key', 'basic', 'oauth2', 'hmac', 'jwt_bearer'] as const;
export type AuthMethodName = (typeof AUTH_METHODS)[number];
export const TRIGGER_OPERATORS = ['equals', 'not_equals', 'exists', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] as const;
export const PATTERN_STATUSES = ['draft', 'active', 'paused'] as const;

export const TriggerConditionSchema = z.object({ field: z.string().min(1), operator: z.enum(TRIGGER_OPERATORS), value: z.unknown().optional() });
export const RetryPolicySchema = z.object({ max: z.number().int().min(0).max(10).default(3), backoffMs: z.number().int().min(100).max(60_000).default(1000), maxBackoffMs: z.number().int().min(100).max(300_000).default(30_000), retryOn: z.array(z.number().int()).default([429, 502, 503, 504]) });
export const RequestConfigSchema = z.object({ method: z.enum(HTTP_METHODS), urlTemplate: z.string().min(1).max(2000), headers: z.record(z.string(), z.string()).default({}), bodyTemplate: z.string().max(50_000).optional(), timeoutMs: z.number().int().min(1000).max(120_000).default(30_000), retries: RetryPolicySchema.default({}) });
export const AuthConfigSchema = z.object({ method: z.enum(AUTH_METHODS), vaultKey: z.string().regex(/^[a-z0-9_]+$/), config: z.record(z.string(), z.unknown()).default({}) });
export const ResponseMappingSchema = z.object({ source: z.string().min(1), target: z.string().min(1), transform: z.string().optional(), args: z.record(z.string(), z.unknown()).optional() });
export const ResponseConfigSchema = z.object({ mode: z.enum(['sync', 'async_callback']).default('sync'), successCodes: z.array(z.number().int()).min(1).default([200, 201, 202, 204]), mapping: z.array(ResponseMappingSchema).default([]) });
export const AiConfigSchema = z.object({ enabled: z.boolean().default(false), promptTemplate: z.string().max(10_000).optional(), maxResponseChars: z.number().int().min(500).max(200_000).default(20_000) });
export const InboundConfigSchema = z.object({ matchHeaders: z.record(z.string(), z.string()).default({}), matchBodyFields: z.record(z.string(), z.unknown()).default({}), mapping: z.array(ResponseMappingSchema).default([]), correlationField: z.string().optional() });
export const CallbackConfigSchema = z.object({ correlationField: z.string().min(1), timeoutMs: z.number().int().min(1000).max(86_400_000).default(86_400_000), onTimeout: z.enum(['retry', 'escalate', 'dead_letter']).default('dead_letter') });
export const RateLimitSchema = z.object({ maxPerMinute: z.number().int().min(1).optional(), maxPerHour: z.number().int().min(1).optional() });

export const IntegrationPatternSchema = z.object({
  id: z.string().regex(/^[A-Z0-9_]+$/).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  direction: z.enum(['outbound', 'inbound']),
  status: z.enum(PATTERN_STATUSES).default('draft'),
  version: z.number().int().min(1).default(1),
  approvedBy: RefSchema.optional(), approvedAt: ISODateSchema.optional(),
  trigger: z.object({ event: z.string().optional(), conditions: z.array(TriggerConditionSchema).default([]) }).default({}),
  variables: z.record(z.string(), z.string()).default({}),
  request: RequestConfigSchema.optional(),
  auth: AuthConfigSchema.optional(),
  response: ResponseConfigSchema.default({}),
  ai: AiConfigSchema.default({}),
  inbound: InboundConfigSchema.optional(),
  callback: CallbackConfigSchema.optional(),
  rateLimits: RateLimitSchema.default({}),
  drift: z.object({ fingerprint: z.string().optional(), approvedAt: ISODateSchema.optional() }).default({}),
  provenance: ProvenanceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type IntegrationPattern = z.infer<typeof IntegrationPatternSchema>;
export type IntegrationPatternInput = z.input<typeof IntegrationPatternSchema>;
/** Parses with defaults; provenance defaults to a system source. */
export function definePattern(input: Omit<IntegrationPatternInput, 'provenance'> & { provenance?: Provenance }, now?: () => ISODate): IntegrationPattern;
// lifecycle: approvePattern(p, by, at?) -> active (from draft or paused), version+1; pausePattern(p) -> paused (from active); resumePattern(p) -> active only when approvedBy is set, else IntegrationsError('NOT_APPROVED'); updatePattern(p, patch) -> version+1, status back to 'draft' when request/auth/response/inbound changed
export function evaluateTrigger(pattern: IntegrationPattern, ctx: unknown, event?: string): { matched: boolean; results: Array<{ field: string; operator: string; expected: unknown; actual: unknown; passed: boolean }>; eventMatched: boolean };
export interface PatternStore { list(filter?: { direction?; status?; search? }): Promise<IntegrationPattern[]>; get(id: string): Promise<IntegrationPattern | undefined>; upsert(p: IntegrationPattern): Promise<IntegrationPattern>; remove(id: string): Promise<boolean> }
export function createInMemoryPatternStore(initial?: readonly IntegrationPattern[]): PatternStore;
```
Trigger operators over `resolvePath(ctx, field)` (from Task 2; implement `resolvePath` in `template.ts` and import it): `contains` works on strings and arrays; `in`/`not_in` expect an array `value`; `exists` = not undefined/null; comparisons numeric.

- [ ] **Step 1: Failing tests.** `definePattern` fills defaults (status draft, version 1, retries `{ max: 3, backoffMs: 1000, maxBackoffMs: 30000, retryOn: [429,502,503,504] }`, successCodes); id regex rejects `weather-lookup`; lifecycle: approve sets active/approvedBy/version 2, pause, resume ok after approval, resume of a never-approved paused pattern throws `NOT_APPROVED`, `updatePattern` bumps version and returns to draft when the request changes but not when only `description` changes; `evaluateTrigger` table over every operator plus event match; store CRUD, `list({ search: 'weather' })` matches name or description case-insensitively.
- [ ] **Step 2: Implement.** `pnpm install`. **Step 3: Verify, commit** `feat(integrations): scaffold with the pattern schema, lifecycle, trigger evaluation, and store port`.

---

### Task 2: Interpolation and transforms

**Files:** `src/template.ts`, `src/transforms.ts`; tests `template.test.ts`, `transforms.test.ts`.

**Interfaces:**
```ts
// template.ts
export function resolvePath(obj: unknown, path: string): unknown;             // dot path with numeric indexes
export interface InterpolationScope { ctx?: unknown; vars?: Record<string, string>; secrets?: Record<string, string> }
export const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
/** {{ctx.a.b}} and bare {{a.b}} read ctx; {{vars.x}} reads vars; {{vault:key}} reads secrets (left literal when absent and `keepUnresolvedVault` is set); missing values render as ''. */
export function interpolate(template: string, scope: InterpolationScope, opts?: { keepUnresolvedVault?: boolean; onMissing?: 'empty' | 'error' }): string;
export function findVaultRefs(template: string): string[];                     // unique keys, in order
export function interpolateObject<T>(value: T, scope: InterpolationScope, opts?): T;   // walks strings in objects/arrays

// transforms.ts
export type Transform = (value: unknown, args: Record<string, unknown>) => unknown;
export const TRANSFORMS: Readonly<Record<string, Transform>>;  // uppercase, lowercase, trim, to_number, to_boolean, date_format (args.format 'iso'|'date'), cents_to_units, units_to_cents, split (delimiter, index), concat (prefix, suffix, separator), default_value (default), lookup (map, default), conditional (condition, compareTo, ifTrue, ifFalse), jsonpath (path), regex_extract (pattern, group, default), to_json, from_json
export function applyTransform(name: string, value: unknown, args?: Record<string, unknown>, registry?: Record<string, Transform>): unknown;  // unknown name -> IntegrationsError('UNKNOWN_TRANSFORM')
export function applyMapping(data: unknown, mapping: readonly ResponseMapping[], registry?: Record<string, Transform>): Record<string, unknown>;  // empty mapping -> data as a record (or { value: data } when not an object); target supports dot paths (creates nested objects)
```

- [ ] **Step 1: Failing tests.** `interpolate('{{ctx.yard.name}} {{vars.baseUrl}} {{vault:api_key}} {{missing}}', …)` renders each root; bare path reads ctx; `onMissing: 'error'` throws `MISSING_VALUE` naming the path; `keepUnresolvedVault` leaves `{{vault:api_key}}` literal; `findVaultRefs` dedupes; `interpolateObject` on a nested body. Transforms: a table over every registered transform with a passing case and its pass-through case; unknown name throws; `applyMapping` with two mappings and a transform, a nested target `weather.tempC`, and an empty mapping.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(integrations): template interpolation with explicit roots and vault references; transform registry and response mapping`.

---

### Task 3: Vault and auth methods

**Files:** `src/vault.ts`, `src/auth.ts`; tests `vault.test.ts`, `auth.test.ts`.

**Interfaces:**
```ts
// vault.ts
export interface VaultEntryMeta { key: string; name?: string; type?: string; createdAt: ISODate; rotatedAt?: ISODate; expiresAt?: ISODate; active: boolean }
export interface VaultPort {
  get(key: string): Promise<string | undefined>;      // undefined when missing, inactive, or expired
  set(key: string, value: string, meta?: Partial<Pick<VaultEntryMeta, 'name' | 'type' | 'expiresAt'>>): Promise<VaultEntryMeta>;
  rotate(key: string, value: string): Promise<VaultEntryMeta>;   // IntegrationsError('VAULT_MISSING') when absent
  remove(key: string): Promise<boolean>;               // deactivates
  list(): Promise<VaultEntryMeta[]>;                   // never values
}
export function createInMemoryVault(opts?: { now?: () => ISODate }): VaultPort;
/** AES-256-GCM helpers for adapters: key is 32 bytes (hex or Buffer); output hex `iv:tag:ciphertext`. */
export function encryptSecret(plaintext: string, key: string | Buffer): string;
export function decryptSecret(sealed: string, key: string | Buffer): string;
/** Resolve every {{vault:key}} in a template through the port; missing -> IntegrationsError('VAULT_MISSING'). */
export async function resolveVaultRefs(vault: VaultPort, templates: readonly string[]): Promise<Record<string, string>>;  // key -> secret

// auth.ts
export interface OutboundRequest { method: string; url: string; headers: Record<string, string>; body?: string }
export interface InboundRequest { headers: Record<string, string>; rawBody: string }
export interface AuthMethod {
  name: AuthMethodName;
  /** Returns a new request with credentials applied. */
  inject(req: OutboundRequest, secret: string, config: Record<string, unknown>, deps: { fetch: typeof fetch; now: () => number }): Promise<OutboundRequest>;
  /** Verifies an inbound request against the secret. */
  verify(req: InboundRequest, secret: string, config: Record<string, unknown>, deps: { now: () => number }): Promise<{ valid: boolean; identity?: string; error?: string }>;
}
export function getAuthMethod(name: string): AuthMethod;   // IntegrationsError('UNKNOWN_AUTH_METHOD')
export const AUTH: Record<AuthMethodName, AuthMethod>;
// api_key: config { placement: 'header' | 'query' ('header'), name ('X-API-Key'), prefix ('') }; verify: header/query timing-safe equal
// basic: secret 'user:pass' -> Authorization: Basic; verify decodes and compares; identity = user
// oauth2: secret is JSON { clientId, clientSecret, tokenUrl, scope? }; client-credentials POST (form) via deps.fetch; token cache keyed clientId@tokenUrl with a 30 s buffer; injects Bearer; verify: config.introspectionUrl (POST, Basic client auth, checks active) else any non-empty bearer is valid=false with error 'introspection not configured' (deviation: never accept blindly)
// hmac: config { algorithm ('sha256'), header ('X-Signature'), encoding ('hex'), prefix ('') }; signs body; verify timing-safe
// jwt_bearer: config { algorithm 'HS256', expiresInSec (300), issuer, audience, subject, claims }; signJwt/verifyJwt helpers exported; verify checks signature, exp, iss, aud; identity = sub ?? iss
export function maskHeaders(headers: Record<string, string>): Record<string, string>;   // authorization, x-api-key, x-signature, cookie, and any header named in config -> first 6 chars + '***'
export function redactUrl(url: string): string;    // query string -> ?[redacted]
export function clearTokenCache(): void;           // test hook
```

- [ ] **Step 1: Failing tests.** Vault: set/get, expired returns undefined, remove deactivates, rotate updates `rotatedAt`, `list` has no values, `encryptSecret`/`decryptSecret` round-trip and a tampered tag throws, `resolveVaultRefs` collects keys across templates and throws on a missing one. Auth: each method's `inject` output (header vs query placement, Basic base64, HMAC hex signature over the body verified with `node:crypto`, JWT decodes with the expected claims and `exp`), `verify` accepts the matching credential and rejects a wrong one with a message; OAuth2 `inject` posts the form to `tokenUrl` through an injected fetch once and reuses the cached token within the buffer; masking and redaction.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(integrations): vault port with AES-GCM helpers; five auth methods with inject and verify`.

---

### Task 4: Resilience

**Files:** `src/resilience.ts`; test `resilience.test.ts`.

**Interfaces:**
```ts
export interface RateLimiter { check(key: string, limits: { maxPerMinute?: number; maxPerHour?: number }): { allowed: boolean; retryAfterMs?: number }; record(key: string): void; reset(key?: string): void }
export function createRateLimiter(opts?: { clock?: () => number; defaultPerMinute?: number (60); defaultPerHour?: number (1000) }): RateLimiter;
export type BreakerState = 'closed' | 'open' | 'half_open';
export interface BreakerSnapshot { state: BreakerState; consecutiveFailures: number; openedAt?: number; lastProbe?: 'success' | 'failure' }
export interface CircuitBreaker { check(key: string): { allowed: boolean } & BreakerSnapshot; success(key: string): void; failure(key: string): void; reset(key: string): void; state(key: string): BreakerSnapshot }
export function createCircuitBreaker(opts?: { failureThreshold?: number (5); cooldownMs?: number (60_000); clock?: () => number }): CircuitBreaker;   // half_open admits one probe at a time: a second check while a probe is in flight is blocked
export interface RetryOptions { max: number; backoffMs: number; maxBackoffMs: number; retryOn: readonly number[]; sleep?: (ms: number) => Promise<void>; jitter?: () => number /* 0..1, default Math.random */ }
export interface Attempt<T> { attempt: number; result?: T; status?: number; error?: string }
/** Calls fn until it returns a non-retryable status, succeeds, or attempts run out. Thrown errors are retried. */
export async function retry<T>(fn: (attempt: number) => Promise<{ status: number; value: T }>, isSuccess: (status: number) => boolean, opts: RetryOptions): Promise<{ ok: boolean; value?: T; status?: number; error?: string; attempts: Attempt<T>[] }>;
export function backoffFor(attempt: number, opts: Pick<RetryOptions, 'backoffMs' | 'maxBackoffMs'>, jitter: number): number;   // min(backoff * 2^(attempt-1), max) * (0.5 + jitter/2)
export type DeadLetterSource = 'outbound_failure' | 'inbound_unmatched' | 'inbound_low_confidence' | 'correlation_timeout' | 'schema_drift';
export interface DeadLetter { id: string; at: ISODate; source: DeadLetterSource; patternId?: string; payload: unknown; error?: string; metadata?: Record<string, unknown>; status: 'pending' | 'replayed' | 'discarded'; attempts: number; resolvedAt?: ISODate; resolvedBy?: Ref }
export interface DeadLetterQueue { enqueue(input: Omit<DeadLetter, 'id' | 'at' | 'status' | 'attempts'>): Promise<DeadLetter>; list(filter?: { source?; status?; patternId? }, opts?: { limit?; offset? }): Promise<{ entries: DeadLetter[]; total: number }>; get(id): Promise<DeadLetter | undefined>; /** Runs the handler; on success marks replayed, on failure increments attempts and keeps pending with the new error. */ replay(id: string, handler: (entry: DeadLetter) => Promise<void>, by?: Ref): Promise<DeadLetter>; discard(id, by?): Promise<DeadLetter | undefined> }
export function createInMemoryDeadLetterQueue(opts?: { now?: () => ISODate }): DeadLetterQueue;
export function fingerprint(data: unknown, maxDepth?: number (3)): string;   // sha256 of sorted `path:type` lines; arrays as path:array + path[]
export function checkDrift(pattern: IntegrationPattern, data: unknown): { drifted: boolean; fingerprint?: string; previous?: string };  // no baseline -> { drifted: false, fingerprint } (caller stores it)
```

- [ ] **Step 1: Failing tests** with injected clocks: limiter blocks at the per-minute cap and frees after 60 s, per-hour cap, `retryAfterMs`; breaker opens on the fifth failure, blocks during cooldown, admits exactly one half-open probe, closes on probe success and reopens on probe failure, `reset`; `retry` stops on success, retries only listed statuses, retries thrown errors, exhausts with the last error, backoff sequence with jitter `() => 1` is `[1000, 2000, 4000]` capped at `maxBackoffMs`; dead letter enqueue/list/replay success and failure/discard; `fingerprint` stable across key order, differs when a type changes, ignores values; `checkDrift` baseline and drift.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(integrations): rate limiter, circuit breaker, retry with capped jittered backoff, dead-letter queue with replay, schema-drift fingerprints`.

---

### Task 5: Execution audit and outbound execution

**Files:** `src/audit.ts`, `src/prompts.ts`, `src/execute.ts`; tests `audit.test.ts`, `execute.test.ts`.

**Interfaces:**
```ts
// audit.ts
export type ExecutionStatus = 'success' | 'failure' | 'circuit_open' | 'rate_limited' | 'trigger_skip' | 'dry_run' | 'inbound' | 'manual';
export interface ExecutionRecord { traceId: string; at: ISODate; patternId: string; direction: 'outbound' | 'inbound'; status: ExecutionStatus; subject?: Ref; request?: { method: string; url: string; headers: Record<string, string>; bodyPreview?: string }; response?: { status?: number; bodyPreview?: string; output?: Record<string, unknown> }; error?: string; latencyMs: number; attempts: number; aiProcessed: boolean; drift?: boolean; metadata?: Record<string, unknown> }
export interface HealthSummary { patternId: string; total: number; success: number; failure: number; circuitOpen: number; rateLimited: number; successRate: number; avgLatencyMs: number; maxLatencyMs: number; lastAt?: ISODate }
export interface ExecutionAuditSink { record(r: ExecutionRecord): Promise<void>; get(traceId): Promise<ExecutionRecord | undefined>; list(filter?: { patternId?; status?; subject?: Ref; direction? }, opts?: { limit?; offset? }): Promise<{ entries: ExecutionRecord[]; total: number }>; health(patternId?: string, sinceMs?: number): Promise<HealthSummary[]> }
export function createInMemoryExecutionAudit(opts?: { now?: () => ISODate; clock?: () => number }): ExecutionAuditSink;
export const PREVIEW_CHARS = 2000;

// prompts.ts
export interface IntegrationEngineOptions { client?: ModelClient; domain?: string; model?: ModelRole; now?: () => ISODate; clock?: () => number }
export const POST_PROCESS_PROMPT = definePrompt<{ domain: string }>({ name: 'integrations.post-process', version: '1.0.0', sections: [fromContext('role', (c) => `You turn a REST API response for ${c.domain} into the structured object an administrator described. Use only what the response contains; leave out fields it does not support.`, { stable: true })] });
export const CLASSIFY_INBOUND_PROMPT = definePrompt<{ domain: string }>({ name: 'integrations.classify-inbound', version: '1.0.0', sections: [fromContext('role', (c) => `You match an inbound webhook for ${c.domain} to one of the candidate integration patterns from its headers and payload. Answer with the pattern id or null, a confidence from 0 to 1, and one sentence of reasoning.`, { stable: true })] });
export function integrationsPromptRegistry(): PromptRegistry;

// execute.ts
export interface ExecuteDeps { fetch?: typeof fetch; vault: VaultPort; audit?: ExecutionAuditSink; limiter?: RateLimiter; breaker?: CircuitBreaker; deadLetters?: DeadLetterQueue; engine?: IntegrationEngineOptions; sleep?: (ms: number) => Promise<void>; jitter?: () => number; onOutput?: (output: Record<string, unknown>, ctx: unknown, pattern: IntegrationPattern) => Promise<void> | void; onDrift?: (pattern: IntegrationPattern, fingerprint: string) => Promise<void> | void }
export interface ExecuteInput { ctx: unknown; subject?: Ref; event?: string; dryRun?: boolean; traceId?: string; label?: string }
export interface BuiltRequest extends OutboundRequest { timeoutMs: number; vaultKeys: string[] }
/** Interpolate url, headers, body against { ctx, vars, secrets }; inject auth; add X-Request-Id. */
export async function buildRequest(pattern: IntegrationPattern, input: ExecuteInput, deps: Pick<ExecuteDeps, 'vault' | 'fetch'> & { traceId: string; now?: () => number }): Promise<BuiltRequest>;
export interface ExecutionResult { traceId: string; status: ExecutionStatus; success: boolean; statusCode?: number; data?: unknown; output?: Record<string, unknown>; error?: string; latencyMs: number; attempts: number; aiProcessed: boolean; drift?: { drifted: boolean; fingerprint?: string }; request?: { method: string; url: string; headers: Record<string, string>; body?: string } /* masked, dry run only */; trigger?: ReturnType<typeof evaluateTrigger> }
export async function executePattern(pattern: IntegrationPattern, input: ExecuteInput, deps: ExecuteDeps): Promise<ExecutionResult>;
```
Order in `executePattern`: status must be `active` (else `failure` with `error 'Pattern is <status>'`, no audit) → breaker → limiter → trigger (`trigger_skip` when the event or conditions do not match; skipped entirely when the pattern has no conditions and no event) → `request` required → build → dry run returns masked request and audits `dry_run` → `retry` around `fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) })` → failure: breaker.failure, dead letter `outbound_failure` with the masked request and the error, audit `failure` → success: breaker.success, drift (`onDrift` when a baseline exists and differs; a new baseline is reported through `onDrift` too with `drifted false`? No: the result carries `drift`, the caller persists), AI post-processing when enabled (`generateObject(z.record(z.string(), z.unknown()), …)` with the interpolated prompt template and the response body truncated to `maxResponseChars`; failure → `aiProcessed false`, `error` noted in `metadata.aiError`, mapping runs on the raw body), mapping, `onOutput`, audit `success`. Response body: JSON when the content type says so, else text. `attempts` counts fetch calls.

- [ ] **Step 1: Failing tests.** Audit: record/get/list/health with two patterns. Execute, with a fake fetch that records calls and returns scripted `Response`s: (a) a GET pattern with `{{vars.baseUrl}}`, `{{ctx.yard.city}}`, an API key from the vault in a query param, and two mappings → success, `output`, the call's URL has the key and `X-Request-Id === traceId`, the audit's request URL is redacted, `onOutput` called; (b) dry run → no fetch, masked request, audit `dry_run`; (c) 503 then 200 → `attempts 2`, sleep called once; (d) three 503s with `retries.max 2` → failure, dead letter enqueued with a masked request, breaker failure counted, audit `failure`; (e) breaker open → `circuit_open` without fetch; (f) limiter → `rate_limited`; (g) trigger conditions unmet → `trigger_skip`; (h) draft pattern → `failure` and no audit; (i) AI post-processing with a fake `{ object: { tempC: 21 } }` → `aiProcessed`, mapping applied to the AI object, the fake's user message contains the truncated body; a fake `error` → `aiProcessed false`, mapping on the raw body, `metadata.aiError` in the audit; (j) drift: first success stores nothing but reports `fingerprint`, a pattern with a stored fingerprint and a changed shape reports `drifted true` and calls `onDrift`; (k) missing vault key → `failure` with `VAULT_MISSING` message, no fetch.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(integrations): outbound execution with dry run, resilience gates, retry, AI post-processing, mapping, and a traced audit`.

---

### Task 6: Inbound webhooks, classification, correlation

**Files:** `src/inbound.ts`; test `inbound.test.ts`.

**Interfaces:**
```ts
export interface SenderConfig { id: string; auth?: { method: AuthMethodName; vaultKey: string; config?: Record<string, unknown> }; ipAllowlist?: string[]; patternIds?: string[] }
export interface InboundInput { sender: SenderConfig; headers: Record<string, string>; rawBody: string; sourceIp?: string; patternId?: string; subject?: Ref; label?: string }
export interface InboundDeps { patterns: PatternStore; vault: VaultPort; audit?: ExecutionAuditSink; deadLetters?: DeadLetterQueue; correlations?: CorrelationStore; engine?: IntegrationEngineOptions; thresholds?: { deadLetterBelow?: number (0.75); reviewBelow?: number (0.95) }; onOutput?: (output, pattern, input) => Promise<void> | void }
export type InboundAction = 'executed' | 'classified' | 'needs_review' | 'correlated' | 'dead_lettered' | 'rejected';
export interface InboundResult { action: InboundAction; traceId: string; patternId?: string; classification?: { assertion: Assertion; confidence: number; reasoning: string }; output?: Record<string, unknown>; correlationId?: string; error?: string }
export async function verifySender(sender: SenderConfig, req: { headers; rawBody; sourceIp? }, vault: VaultPort): Promise<{ valid: boolean; identity?: string; error?: string }>;  // ip allowlist exact match; auth via getAuthMethod(...).verify
export function matchInbound(patterns: readonly IntegrationPattern[], headers: Record<string, string>, payload: unknown): IntegrationPattern[];   // active inbound patterns whose inbound.matchHeaders (case-insensitive names) and matchBodyFields all equal; patterns with no match config never match here
export const ClassificationSchema = z.object({ patternId: z.string().nullable(), confidence: z.number().min(0).max(1), reasoning: z.string() });
export async function classifyInbound(candidates: readonly IntegrationPattern[], headers, payload, engine: IntegrationEngineOptions, opts?: { subject?: Ref; label?; maxPayloadChars?: number (2000) }): Promise<{ pattern?: IntegrationPattern; confidence: number; reasoning: string; assertion: Assertion; usage: Usage }>;  // headers masked before the prompt; user message: candidates `- id: name — description`, headers, truncated payload
export interface Correlation { id: string; patternId: string; field: string; subject?: Ref; createdAt: ISODate; expiresAt: ISODate; status: 'pending' | 'matched' | 'expired' | 'cancelled'; matchedAt?: ISODate; payload?: unknown; onTimeout: 'retry' | 'escalate' | 'dead_letter' }
export interface CorrelationStore { create(input: { patternId; field; subject?; timeoutMs; onTimeout }): Promise<Correlation>; match(payload: unknown, patternId?: string): Promise<Correlation | undefined>; complete(id, payload): Promise<Correlation | undefined>; cancel(id): Promise<boolean>; expire(now?: ISODate): Promise<Correlation[]>; list(filter?): Promise<Correlation[]> }
export function createInMemoryCorrelationStore(opts?: { now?: () => ISODate }): CorrelationStore;
export async function receiveWebhook(input: InboundInput, deps: InboundDeps): Promise<InboundResult>;
```
Flow: verify sender (fail → `rejected`, audited with status `inbound` and the error) → parse JSON body (invalid → `rejected`) → candidates = `sender.patternIds` ∩ active inbound, else all active inbound → `input.patternId` names one (must be a candidate, else `rejected`) → else `matchInbound` (exactly one hit → that pattern; several → the first by id; none → classification when a client is set, else `dead_lettered` `inbound_unmatched`) → classification: null or below `deadLetterBelow` → `dead_lettered` `inbound_low_confidence` with confidence and reasoning in metadata; below `reviewBelow` → `needs_review` (result carries the assertion; nothing executed); else `classified` → correlation match on the pattern (`inbound.correlationField`; hit → `complete`, `correlated`) → `applyMapping(payload, inbound.mapping)` → `onOutput` → audit `inbound` with `output` → `executed` (or `classified`).

- [ ] **Step 1: Failing tests.** `verifySender` with HMAC (valid, wrong signature, IP not allowed); `matchInbound` on headers and body fields; `classifyInbound` with a fake, assertion proposed with predicate `matches-pattern`, headers masked in the prompt (`authorization` value absent), payload truncated; correlation create/match/complete/expire with an injected clock; `receiveWebhook` end to end: explicit pattern id → `executed` with output and an audit record; deterministic match; classification at 0.97 → `classified`; at 0.8 → `needs_review`; at 0.5 → `dead_lettered`; no client and no match → `dead_lettered` `inbound_unmatched`; correlation hit → `correlated`; bad signature → `rejected`.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(integrations): inbound webhooks with sender verification, deterministic matching, classification as an assertion, and correlation`.

---

### Task 7: Admin tools, README, acceptance

**Files:** `src/tools.ts`, `src/index.ts`, `README.md`; tests `tools.test.ts`, `acceptance.test.ts`.

**Interfaces:**
```ts
export interface IntegrationToolsOptions<TCtx> { store: PatternStore; vault: VaultPort; deps: Omit<ExecuteDeps, 'vault'>; actorFromCtx: (ctx: TCtx) => Ref; /** The host context templates interpolate against; default the agent ctx itself. */ executionCtx?: (ctx: TCtx) => unknown; onChange?: () => void }
export function integrationTools<TCtx>(opts: IntegrationToolsOptions<TCtx>): AnyTool<TCtx>[];
```
Tools: `list_integration_patterns { direction?, status?, search? }` (one `integration-pattern-card` per pattern); `create_integration_pattern { pattern: <IntegrationPatternInput minus provenance> }` (draft, provenance human = actor, validation errors returned softly, card); `update_integration_pattern { id, patch }`; `test_integration_pattern { id, event? }` (dry run: masked request + trigger evaluation, `integration-test-card`); `approve_integration_pattern { id }` (actor recorded); `pause_integration_pattern { id }`; `resume_integration_pattern { id }` (soft failure when never approved); `run_integration_pattern { id, event? }` (real execution; `integration-trace-card`); `show_integration_trace { traceId }`; `show_integration_health { id? }`; `list_dead_letters { source?, status? }`; `replay_dead_letter { id }` (re-executes the pattern with the stored ctx); `reset_circuit_breaker { id }`; `manage_credentials { action: 'list' | 'set' | 'rotate' | 'remove', key, value?, name?, type? }` (description warns that `value` passes through the conversation; the result never echoes it). Every tool result masks secrets.

README: surface table, guarantees, the composition example (store + vault + deps + tools on an agent; `receiveWebhook` in a route). Acceptance test (§7): a vault key, a draft pattern against a fake fetch, `test` → `approve` → `run` through the tools on an `@apogee/agent` session with a scripted fake, then a broken fetch → failure → dead letter → `replay_dead_letter` with the fetch fixed → replayed; an inbound payload classified through `receiveWebhook` with a fake at 0.96 → `classified` with output.

- [ ] **Step 1: Failing tests. Step 2: Implement; README. Step 3: Verify (≥ 90%), commit** `feat(integrations): admin tools for @apogee/agent, README, and the acceptance test`.

---

### Task 8: Verification, docs, PR

- [ ] Root pipeline; coverage. Add the package to `docs/consuming.md` and the root `README.md` table; TODO (B5 → PR open; Jeff merges and tags `integrations-v0.1.0`). Commit, push, PR with the plan as body.

---

### Task 9: apogee-build integration demo (branch `feature/integrations-demo`)

**Files:** `vendor/apogee-integrations-0.1.0.tgz`, `package.json`, `src/packages.ts`, `src/demo/rental/integrations/mock-api.ts` (`createMockApi({ faults })`: a `fetch`-compatible function serving `https://api.mock.apogee.build/geocode?q=…` → `{ results: [{ lat, lon, label }] }` for the two yards and a few cities, `/weather?lat=&lon=` → `{ current: { temp_c, wind_kph, condition } }`, `/token` (OAuth2 client credentials) → `{ access_token, expires_in }`; `faults.failNext` makes the next N calls return 503; requires `X-API-Key: demo-key-…` else 401), `patterns.ts` (two seed patterns in draft: `GEOCODE_YARD` (GET, api_key in query, maps `results.0.lat|lon|label`) and `YARD_WEATHER` (GET, `{{ctx.lat}}`, `{{ctx.lon}}`, AI post-processing off by default, maps `current.temp_c` → `weather.tempC` with `to_number`, `current.condition` → `weather.condition`), and one inbound `DELIVERY_STATUS` (match header `x-source: courier`, mapping `status`, `rentalNumber`)), `server.ts` (`integrationsFor(visitorId)` → `{ store, vault (seeded with `mock_api_key` and `courier_hmac`), audit, deadLetters, breaker, limiter, correlations, faults, mockFetch }`; `integrationDeps(world)`; demo-mode fake client for the classifier and post-processor in `script.ts`), `src/app/api/integrations/route.ts` (`GET` → `{ patterns, health, deadLetters, breaker states, demoMode }`; `POST { action: 'test' | 'approve' | 'pause' | 'resume' | 'run' | 'replay' | 'reset_breaker' | 'set_faults' | 'save', id?, ctx?, faults?, pattern? }` → the corresponding package call, JSON result with masked request), `src/app/api/webhooks/[sender]/route.ts` (`POST` raw body → `receiveWebhook` with the `courier` sender (HMAC) → JSON result), `src/components/IntegrationsDemo.tsx` (left: pattern list with status badges and a JSON editor for the selected pattern, Save; right: context editor prefilled `{ yard: { name: 'north', city: 'Austin' } }`, buttons Test / Approve / Run, a fault toggle "Fail the next 3 calls", the last result card (status, attempts, latency, masked request, output), a trace list, health, dead letters with Replay, breaker state with Reset; bottom: "Send a courier webhook" with a sample JSON body and a Signed checkbox, showing the inbound result), `src/app/demo/integrations/page.tsx`. `admin.ts`: the admin assistant session gains `integrationTools` over the visitor's world so the manager can say "run the yard weather for the north yard". Tests `integrations.test.ts`: GET lists the three seeds; `test` returns a masked request with the key as `demo-k***`; `approve` then `run` GEOCODE_YARD → output with `lat`; with `failNext: 3` and retries 2 → failure, a dead letter, breaker failures; `replay` after clearing faults → replayed; the webhook route with a valid HMAC → `executed`, with a bad one → `rejected`.

- [ ] Vendor + install + smoke; commit. Red tests; implement; `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; commit `feat(demo): add the integration demo (patterns, dry run, approval, resilience, dead letters, inbound webhooks)`; push; PR.

---

### Task 10: File the plan

- [ ] Move to `docs/plans/completed/` with the outcome note; TODO (queue: B6b next); memory. Docs PR.

---

## Self-review

- **§3.9 coverage:** `IntegrationPattern` schema as-is with the survey's fields (T1); `executePattern` with rate limit, circuit breaker, retry, dead letter, drift, audit (T4, T5); AI post-processing and inbound classification through `@apogee/ai` with registered prompts, classification as an assertion (T5, T6); `VaultPort` and five auth methods (T3); admin tools as `Tool<TContext>[]` (T7). §5 demo: author a pattern against a mock API and run it (T9).
- **§2 rules:** ports with in-memory implementations (store, vault, audit, dead letters, limiter, breaker, correlations); injected vocabulary; assertions for AI output; one client; registered prompts; secrets masked everywhere.
- **Type consistency:** `IntegrationPattern` (T1) is the input to `evaluateTrigger`, `buildRequest`, `executePattern`, `matchInbound`, `receiveWebhook`, and the tools; `OutboundRequest` (T3) is what `buildRequest` (T5) produces and auth `inject` consumes; `ResponseMapping` (T1) drives `applyMapping` (T2) in both directions; `ExecutionRecord` (T5) is what inbound (T6) and tools (T7) read; `DeadLetter` (T4) is what `replay` (T4) and the tools (T7) handle.
- **Placeholders:** none; every prompt has its text, every LLM function its output schema, every test its fixture.
