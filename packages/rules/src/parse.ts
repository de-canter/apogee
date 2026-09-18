import type { Usage } from '@apogee/ai';
import { assertion, confirmAssertion, confirm, nowIso, rejectAssertion, type Assertion, type ISODate, type Ref } from '@apogee/kernel';
import { composePrompt, toSystemBlocks } from '@apogee/prompts';
import { z } from 'zod';
import type { Conditions, Dimensions, DimensionShape } from './dimensions';
import { RulesError } from './errors';
import { domainOf, requireClient, RULE_PARSER_PROMPT, type RuleEngineOptions } from './prompts';
import { RULE_LIMITS, StructuredCheckSchema, type Rule, type StructuredCheck } from './rule';

export interface Ambiguity { field: string; message: string; suggestions: string[] }
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(c: number): ConfidenceLevel {
  if (c > 0.9) return 'high';
  if (c >= 0.7) return 'medium';
  return 'low';
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function ruleIdFor(category: string, name: string): string {
  return `${slug(category)}-${slug(name)}`;
}

/** The rule fields the model decides; the host adds id, version, enabled, scope, provenance. */
export interface ParsedRuleFields<S extends DimensionShape> {
  name: string;
  description: string;
  category: string;
  conditions: Conditions<S>;
  instruction: string;
  suggestedActions: string[];
  defaultAction?: string;
  structuredChecks: StructuredCheck[];
  priority: number;
}

export function parsedRuleFieldsSchema<S extends DimensionShape>(dims: Dimensions<S>): z.ZodType<ParsedRuleFields<S>> {
  return z.object({
    name: z.string().min(1).max(RULE_LIMITS.nameMax),
    description: z.string().max(RULE_LIMITS.descriptionMax).default(''),
    category: z.string().min(1),
    conditions: dims.conditions,
    instruction: z.string().min(1),
    suggestedActions: z.array(z.string()).default([]),
    defaultAction: z.string().optional(),
    structuredChecks: z.array(StructuredCheckSchema).default([]),
    priority: z.number().int().min(RULE_LIMITS.priorityMin).max(RULE_LIMITS.priorityMax).default(100),
  }) as unknown as z.ZodType<ParsedRuleFields<S>>;
}

export interface ParseOutput<S extends DimensionShape> { rule: ParsedRuleFields<S>; confidence: number; ambiguities: Ambiguity[]; summary: string }

export function parseOutputSchema<S extends DimensionShape>(dims: Dimensions<S>): z.ZodType<ParseOutput<S>> {
  return z.object({
    rule: parsedRuleFieldsSchema(dims),
    confidence: z.number().min(0).max(1),
    ambiguities: z.array(z.object({ field: z.string(), message: z.string(), suggestions: z.array(z.string()).default([]) })).default([]),
    summary: z.string().default(''),
  });
}

export interface ParsedRule<S extends DimensionShape> {
  /** Proposed until the administrator confirms; its object is `rule`. */
  assertion: Assertion;
  rule: Rule<S>;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  ambiguities: Ambiguity[];
  summary: string;
  usage: Usage;
}

export interface ParseRuleOptions {
  categoryHint?: string;
  /** Assertion subject; default `{ kind: 'RuleSet', id: 'default' }`. */
  subject?: Ref;
  scope?: Ref;
  label?: string;
}

export const DEFAULT_RULE_SUBJECT: Ref = { kind: 'RuleSet', id: 'default' };
export const PARSE_SOURCE = `${RULE_PARSER_PROMPT.name}@${RULE_PARSER_PROMPT.version}`;

/** Builds a Rule from model-decided fields with AI provenance. Shared with suggestions. */
export function ruleFromFields<S extends DimensionShape>(
  fields: ParsedRuleFields<S>,
  opts: { id: string; confidence: number; sourceName: string; method: string; scope?: Ref; now: () => ISODate },
): Rule<S> {
  return {
    ...fields,
    id: opts.id,
    enabled: true,
    version: 1,
    ...(opts.scope ? { scope: opts.scope } : {}),
    provenance: { source: { kind: 'ai', name: opts.sourceName }, method: opts.method, confidence: opts.confidence, recordedAt: opts.now() },
  };
}

export function checkCategory<S extends DimensionShape>(engine: RuleEngineOptions<S>, category: string): void {
  if (engine.categories && !engine.categories.includes(category)) {
    throw new RulesError(`Unknown rule category "${category}"; expected one of ${engine.categories.join(', ')}`, 'BAD_CATEGORY');
  }
}

/** Natural language → a proposed rule. The administrator confirms with confirmRule. */
export async function parseRule<S extends DimensionShape>(text: string, engine: RuleEngineOptions<S>, opts: ParseRuleOptions = {}): Promise<ParsedRule<S>> {
  const client = requireClient(engine, 'parseRule');
  const now = engine.now ?? nowIso;
  const composed = await composePrompt(RULE_PARSER_PROMPT, { domain: domainOf(engine), dimensions: engine.dims.describe(), categories: engine.categories ?? [] });
  const hint = opts.categoryHint ? `\n\nHint: this rule belongs to the "${opts.categoryHint}" category.` : '';
  const user = `Parse this rule description into a structured behavior rule:\n\n"${text}"${hint}`;
  const { value, usage } = await client.generateObject(
    parseOutputSchema(engine.dims),
    { model: engine.model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: user }], maxTokens: 2048 },
    { ...(opts.label !== undefined ? { label: opts.label } : {}) },
  );
  checkCategory(engine, value.rule.category);
  const rule = ruleFromFields(value.rule, {
    id: ruleIdFor(value.rule.category, value.rule.name),
    confidence: value.confidence,
    sourceName: PARSE_SOURCE,
    method: 'parseRule',
    ...(opts.scope ? { scope: opts.scope } : {}),
    now,
  });
  const a = assertion({ id: crypto.randomUUID(), subject: opts.subject ?? DEFAULT_RULE_SUBJECT, predicate: 'proposes-rule', object: rule, provenance: rule.provenance });
  return { assertion: a, rule, confidence: value.confidence, confidenceLevel: confidenceLevel(value.confidence), ambiguities: value.ambiguities, summary: value.summary, usage };
}

/** The administrator accepts the proposal: the assertion is confirmed and the rule's provenance records who and when. */
export function confirmRule<S extends DimensionShape>(parsed: Pick<ParsedRule<S>, 'assertion' | 'rule'>, by: Ref, at: ISODate = nowIso()): { assertion: Assertion; rule: Rule<S> } {
  const confirmed = confirmAssertion(parsed.assertion, by, at);
  const rule: Rule<S> = { ...parsed.rule, provenance: confirm(parsed.rule.provenance, by, at) };
  return { assertion: { ...confirmed, object: rule }, rule };
}

export function rejectRule<S extends DimensionShape>(parsed: Pick<ParsedRule<S>, 'assertion'>, by: Ref, at: ISODate = nowIso()): Assertion {
  return rejectAssertion(parsed.assertion, by, at);
}
