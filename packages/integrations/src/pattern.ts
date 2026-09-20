import { ISODateSchema, nowIso, ProvenanceSchema, RefSchema, type ISODate, type Provenance, type Ref } from '@de_canter/apogee-kernel';
import { z } from 'zod';
import { IntegrationsError } from './errors';
import { resolvePath } from './template';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const AUTH_METHODS = ['api_key', 'basic', 'oauth2', 'hmac', 'jwt_bearer'] as const;
export type AuthMethodName = (typeof AUTH_METHODS)[number];
export const TRIGGER_OPERATORS = ['equals', 'not_equals', 'exists', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] as const;
export type TriggerOperator = (typeof TRIGGER_OPERATORS)[number];
export const PATTERN_STATUSES = ['draft', 'active', 'paused'] as const;
export type PatternStatus = (typeof PATTERN_STATUSES)[number];

export const TriggerConditionSchema = z.object({ field: z.string().min(1), operator: z.enum(TRIGGER_OPERATORS), value: z.unknown().optional() });
export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

export const RetryPolicySchema = z.object({
  max: z.number().int().min(0).max(10).default(3),
  backoffMs: z.number().int().min(100).max(60_000).default(1000),
  maxBackoffMs: z.number().int().min(100).max(300_000).default(30_000),
  retryOn: z.array(z.number().int()).default([429, 502, 503, 504]),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const RequestConfigSchema = z.object({
  method: z.enum(HTTP_METHODS),
  urlTemplate: z.string().min(1).max(2000),
  headers: z.record(z.string(), z.string()).default({}),
  bodyTemplate: z.string().max(50_000).optional(),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
  retries: RetryPolicySchema.prefault({}),
});
export type RequestConfig = z.infer<typeof RequestConfigSchema>;

export const AuthConfigSchema = z.object({ method: z.enum(AUTH_METHODS), vaultKey: z.string().regex(/^[a-z0-9_]+$/), config: z.record(z.string(), z.unknown()).default({}) });
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const ResponseMappingSchema = z.object({ source: z.string().min(1), target: z.string().min(1), transform: z.string().optional(), args: z.record(z.string(), z.unknown()).optional() });
export type ResponseMapping = z.infer<typeof ResponseMappingSchema>;

export const ResponseConfigSchema = z.object({
  mode: z.enum(['sync', 'async_callback']).default('sync'),
  successCodes: z.array(z.number().int()).min(1).default([200, 201, 202, 204]),
  mapping: z.array(ResponseMappingSchema).default([]),
});
export const AiConfigSchema = z.object({ enabled: z.boolean().default(false), promptTemplate: z.string().max(10_000).optional(), maxResponseChars: z.number().int().min(500).max(200_000).default(20_000) });
export const InboundConfigSchema = z.object({
  matchHeaders: z.record(z.string(), z.string()).default({}),
  matchBodyFields: z.record(z.string(), z.unknown()).default({}),
  mapping: z.array(ResponseMappingSchema).default([]),
  correlationField: z.string().optional(),
});
export const CallbackConfigSchema = z.object({ correlationField: z.string().min(1), timeoutMs: z.number().int().min(1000).max(86_400_000).default(86_400_000), onTimeout: z.enum(['retry', 'escalate', 'dead_letter']).default('dead_letter') });
export const RateLimitSchema = z.object({ maxPerMinute: z.number().int().min(1).optional(), maxPerHour: z.number().int().min(1).optional() });

/** A no-code REST integration: what triggers it, the request it makes (or accepts), how the response maps. */
export const IntegrationPatternSchema = z.object({
  id: z.string().regex(/^[A-Z0-9_]+$/).max(100),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  direction: z.enum(['outbound', 'inbound']),
  status: z.enum(PATTERN_STATUSES).default('draft'),
  version: z.number().int().min(1).default(1),
  approvedBy: RefSchema.optional(),
  approvedAt: ISODateSchema.optional(),
  trigger: z.object({ event: z.string().optional(), conditions: z.array(TriggerConditionSchema).default([]) }).prefault({}),
  /** Host-bound values for `{{vars.name}}`, e.g. a vendor base URL. */
  variables: z.record(z.string(), z.string()).default({}),
  request: RequestConfigSchema.optional(),
  auth: AuthConfigSchema.optional(),
  response: ResponseConfigSchema.prefault({}),
  ai: AiConfigSchema.prefault({}),
  inbound: InboundConfigSchema.optional(),
  callback: CallbackConfigSchema.optional(),
  rateLimits: RateLimitSchema.prefault({}),
  drift: z.object({ fingerprint: z.string().optional(), approvedAt: ISODateSchema.optional() }).prefault({}),
  provenance: ProvenanceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type IntegrationPattern = z.infer<typeof IntegrationPatternSchema>;
export type IntegrationPatternInput = z.input<typeof IntegrationPatternSchema>;
export type PatternDefinition = Omit<IntegrationPatternInput, 'provenance'> & { provenance?: Provenance };

/** Parses with defaults; provenance defaults to a system source recorded now. */
export function definePattern(input: PatternDefinition, now: () => ISODate = nowIso): IntegrationPattern {
  const provenance = input.provenance ?? { source: { kind: 'system' as const }, recordedAt: now() };
  return IntegrationPatternSchema.parse({ ...input, provenance });
}

/** Approval activates a draft or paused pattern and records who. */
export function approvePattern(p: IntegrationPattern, by: Ref, at: ISODate = nowIso()): IntegrationPattern {
  return { ...p, status: 'active', version: p.version + 1, approvedBy: by, approvedAt: at };
}

export function pausePattern(p: IntegrationPattern): IntegrationPattern {
  if (p.status !== 'active') throw new IntegrationsError(`Only an active pattern can be paused; ${p.id} is ${p.status}`, 'NOT_ACTIVE');
  return { ...p, status: 'paused' };
}

/** Resume requires a prior approval; an unapproved pattern goes through approvePattern. */
export function resumePattern(p: IntegrationPattern): IntegrationPattern {
  if (p.status !== 'paused') throw new IntegrationsError(`Only a paused pattern can be resumed; ${p.id} is ${p.status}`, 'NOT_PAUSED');
  if (!p.approvedBy) throw new IntegrationsError(`${p.id} was never approved`, 'NOT_APPROVED');
  return { ...p, status: 'active' };
}

const BEHAVIOR_KEYS: ReadonlyArray<keyof IntegrationPatternInput> = ['request', 'auth', 'response', 'inbound', 'callback', 'variables', 'ai', 'trigger'];

/** A patch bumps the version; a change to what the pattern does sends it back to draft for re-approval. */
export function updatePattern(p: IntegrationPattern, patch: Partial<Omit<IntegrationPatternInput, 'id' | 'version' | 'provenance'>>): IntegrationPattern {
  const behaviorChanged = BEHAVIOR_KEYS.some((k) => k in patch);
  return IntegrationPatternSchema.parse({ ...p, ...patch, version: p.version + 1, status: behaviorChanged ? 'draft' : p.status });
}

export interface TriggerResult { field: string; operator: TriggerOperator; expected: unknown; actual: unknown; passed: boolean }
export interface TriggerEvaluation { matched: boolean; eventMatched: boolean; results: TriggerResult[] }

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);

export function evaluateCondition(c: TriggerCondition, actual: unknown): boolean {
  switch (c.operator) {
    case 'equals':
      return actual === c.value;
    case 'not_equals':
      return actual !== c.value;
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'contains':
      if (typeof actual === 'string') return typeof c.value === 'string' && actual.includes(c.value);
      return Array.isArray(actual) && actual.includes(c.value);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = num(actual);
      const b = num(c.value);
      if (a === undefined || b === undefined) return false;
      return c.operator === 'gt' ? a > b : c.operator === 'gte' ? a >= b : c.operator === 'lt' ? a < b : a <= b;
    }
    case 'in':
      return Array.isArray(c.value) && c.value.includes(actual);
    case 'not_in':
      return Array.isArray(c.value) && !c.value.includes(actual);
  }
}

/** The event must match when the pattern names one; every condition must pass. */
export function evaluateTrigger(pattern: IntegrationPattern, ctx: unknown, event?: string): TriggerEvaluation {
  const eventMatched = pattern.trigger.event === undefined ? true : pattern.trigger.event === event;
  const results = pattern.trigger.conditions.map((c) => {
    const actual = resolvePath(ctx, c.field);
    return { field: c.field, operator: c.operator, expected: c.value, actual, passed: evaluateCondition(c, actual) };
  });
  return { matched: eventMatched && results.every((r) => r.passed), eventMatched, results };
}

export interface PatternFilter { direction?: 'outbound' | 'inbound'; status?: PatternStatus; search?: string }

export interface PatternStore {
  list(filter?: PatternFilter): Promise<IntegrationPattern[]>;
  get(id: string): Promise<IntegrationPattern | undefined>;
  upsert(p: IntegrationPattern): Promise<IntegrationPattern>;
  remove(id: string): Promise<boolean>;
}

export function createInMemoryPatternStore(initial: readonly IntegrationPattern[] = []): PatternStore {
  const map = new Map(initial.map((p) => [p.id, structuredClone(p)]));
  return {
    list(filter = {}) {
      const q = filter.search?.toLowerCase();
      return Promise.resolve(
        [...map.values()]
          .filter((p) => (filter.direction === undefined || p.direction === filter.direction) && (filter.status === undefined || p.status === filter.status) && (q === undefined || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((p) => structuredClone(p)),
      );
    },
    get: (id) => Promise.resolve(map.has(id) ? structuredClone(map.get(id)!) : undefined),
    upsert(p) {
      map.set(p.id, structuredClone(p));
      return Promise.resolve(structuredClone(p));
    },
    remove: (id) => Promise.resolve(map.delete(id)),
  };
}
