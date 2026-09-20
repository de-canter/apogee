import { nowIso, ProvenanceSchema, RefSchema, type ISODate, type Provenance, type Ref } from '@de_canter/apogee-kernel';
import { z } from 'zod';
import type { Conditions, Dimensions, DimensionShape, Facts } from './dimensions';

export const CHECK_OPERATORS = ['exists', 'not_empty', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'matches', 'min_count', 'max_count'] as const;
export type CheckOperator = (typeof CHECK_OPERATORS)[number];

/** A deterministic check against a subject object; evaluated without a model. */
export const StructuredCheckSchema = z.object({
  field: z.string().min(1),
  check: z.enum(CHECK_OPERATORS),
  value: z.union([z.string(), z.number()]).optional(),
  message: z.string().min(1),
  severity: z.enum(['error', 'warning']).default('error'),
});
export type StructuredCheck = z.infer<typeof StructuredCheckSchema>;
export type StructuredCheckInput = z.input<typeof StructuredCheckSchema>;

export interface Rule<S extends DimensionShape> {
  id: string;
  name: string;
  description: string;
  category: string;
  conditions: Conditions<S>;
  /** Natural-language directive injected into the assistant's prompt when the rule applies. */
  instruction: string;
  suggestedActions: string[];
  defaultAction?: string;
  gate?: string;
  structuredChecks: StructuredCheck[];
  /** 0..1000; higher runs first. */
  priority: number;
  enabled: boolean;
  version: number;
  scope?: Ref;
  provenance: Provenance;
}

type Defaulted = 'description' | 'instruction' | 'suggestedActions' | 'structuredChecks' | 'priority' | 'enabled' | 'version' | 'provenance';
export type RuleInput<S extends DimensionShape> = Omit<Rule<S>, Defaulted> &
  Partial<Omit<Pick<Rule<S>, Defaulted>, 'structuredChecks'>> & { structuredChecks?: StructuredCheckInput[] };

export const RULE_LIMITS = { nameMax: 100, descriptionMax: 500, priorityMin: 0, priorityMax: 1000 } as const;

export function ruleSchema<S extends DimensionShape>(dims: Dimensions<S>): z.ZodType<Rule<S>, RuleInput<S>> {
  return z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(RULE_LIMITS.nameMax),
    description: z.string().max(RULE_LIMITS.descriptionMax).default(''),
    category: z.string().min(1),
    conditions: dims.conditions,
    instruction: z.string().default(''),
    suggestedActions: z.array(z.string()).default([]),
    defaultAction: z.string().optional(),
    gate: z.string().optional(),
    structuredChecks: z.array(StructuredCheckSchema).default([]),
    priority: z.number().int().min(RULE_LIMITS.priorityMin).max(RULE_LIMITS.priorityMax).default(100),
    enabled: z.boolean().default(true),
    version: z.number().int().min(1).default(1),
    scope: RefSchema.optional(),
    provenance: ProvenanceSchema,
  }) as unknown as z.ZodType<Rule<S>, RuleInput<S>>;
}

/** Applies defaults; provenance defaults to a system source recorded now. */
export function defineRule<S extends DimensionShape>(dims: Dimensions<S>, input: RuleInput<S>, now: () => ISODate = nowIso): Rule<S> {
  const provenance = input.provenance ?? { source: { kind: 'system' as const }, recordedAt: now() };
  return ruleSchema(dims).parse({ ...input, provenance });
}

export type UnknownFacts = 'fail' | 'pass';

const key = (v: unknown): string => JSON.stringify(v);

/** Conditioned entries: [dimension, allowed values] for non-empty arrays; naturalLanguage is not a dimension. */
function conditioned<S extends DimensionShape>(c: Conditions<S>): Array<[string, unknown[]]> {
  const out: Array<[string, unknown[]]> = [];
  for (const [k, v] of Object.entries(c)) {
    if (k === 'naturalLanguage' || !Array.isArray(v) || v.length === 0) continue;
    out.push([k, v]);
  }
  return out;
}

/**
 * A conditioned dimension requires the fact to be one of its values. Empty arrays and
 * naturalLanguage are ignored. With unknownFacts 'pass', a missing fact does not fail
 * the dimension (used when compiling rules into a prompt before facts are known).
 */
export function matchesConditions<S extends DimensionShape>(conditions: Conditions<S>, facts: Facts<S>, opts: { unknownFacts?: UnknownFacts } = {}): boolean {
  const unknown = opts.unknownFacts ?? 'fail';
  const f = facts as Record<string, unknown>;
  for (const [k, allowed] of conditioned(conditions)) {
    const fact = f[k];
    if (fact === undefined) {
      if (unknown === 'pass') continue;
      return false;
    }
    const fk = key(fact);
    if (!allowed.some((a) => key(a) === fk)) return false;
  }
  return true;
}

export interface FindOptions { category?: string; includeDisabled?: boolean; unknownFacts?: UnknownFacts }

/** Enabled (unless includeDisabled), optional category filter, matching; sorted priority desc then id asc. */
export function findMatchingRules<S extends DimensionShape>(rules: readonly Rule<S>[], facts: Facts<S>, opts: FindOptions = {}): Rule<S>[] {
  return rules
    .filter((r) => (opts.includeDisabled || r.enabled) && (opts.category === undefined || r.category === opts.category))
    .filter((r) => matchesConditions(r.conditions, facts, { ...(opts.unknownFacts ? { unknownFacts: opts.unknownFacts } : {}) }))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

/** For simulation: per conditioned key, the rule's values and the fact; or `{ _unconditional: true }`. */
export function matchedConditions<S extends DimensionShape>(rule: Rule<S>, facts: Facts<S>): Record<string, unknown> {
  const entries = conditioned(rule.conditions);
  if (entries.length === 0) return { _unconditional: true };
  const f = facts as Record<string, unknown>;
  return Object.fromEntries(entries.map(([k, v]) => [k, { rule: v, fact: f[k] }]));
}

/** Drops empty and undefined entries and naturalLanguage; sorts values by their JSON text. */
export function normalizeConditions<S extends DimensionShape>(c: Conditions<S>): Record<string, unknown[]> {
  return Object.fromEntries(conditioned(c).map(([k, v]) => [k, [...v].sort((a, b) => key(a).localeCompare(key(b)))]));
}

export function conditionsIdentical<S extends DimensionShape>(a: Conditions<S>, b: Conditions<S>): boolean {
  const na = normalizeConditions(a);
  const nb = normalizeConditions(b);
  const ka = Object.keys(na).sort();
  const kb = Object.keys(nb).sort();
  if (key(ka) !== key(kb)) return false;
  return ka.every((k) => key(na[k]) === key(nb[k]));
}

/** a matches a subset of the facts b matches: every key of b is in a and a's values are within b's. Empty b ⇒ true. */
export function conditionsNarrower<S extends DimensionShape>(a: Conditions<S>, b: Conditions<S>): boolean {
  const na = normalizeConditions(a);
  const nb = normalizeConditions(b);
  return Object.entries(nb).every(([k, bv]) => {
    const av = na[k];
    if (!av) return false;
    const allowed = new Set(bv.map(key));
    return av.every((v) => allowed.has(key(v)));
  });
}

/** Some fact satisfies both: every key present in both has intersecting values. */
export function conditionsOverlap<S extends DimensionShape>(a: Conditions<S>, b: Conditions<S>): boolean {
  const na = normalizeConditions(a);
  const nb = normalizeConditions(b);
  return Object.entries(na).every(([k, av]) => {
    const bv = nb[k];
    if (!bv) return true;
    const set = new Set(bv.map(key));
    return av.some((v) => set.has(key(v)));
  });
}
