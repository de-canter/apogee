import type { Usage } from '@de_canter/apogee-ai';
import { assertion, nowIso, toDate, type Assertion, type ISODate, type Ref } from '@de_canter/apogee-kernel';
import { composePrompt, toSystemBlocks } from '@de_canter/apogee-prompts';
import { z } from 'zod';
import type { RuleAuditEntry } from './audit';
import type { DimensionShape } from './dimensions';
import { checkCategory, DEFAULT_RULE_SUBJECT, parsedRuleFieldsSchema, ruleFromFields, ruleIdFor } from './parse';
import { domainOf, requireClient, RULE_SUGGESTION_PROMPT, type RuleEngineOptions } from './prompts';
import type { Rule } from './rule';

export type SuggestionSource = 'uncovered_actions' | 'low_engagement' | 'pattern_detection' | 'rule_improvement';
export const SUGGESTION_SOURCES: readonly SuggestionSource[] = ['uncovered_actions', 'low_engagement', 'pattern_detection', 'rule_improvement'];

/** Audit entries where the user went off the rule's script, grouped by trigger and matched conditions. */
export interface OffScriptGroup { trigger: string; conditionsMatched: Record<string, unknown>; exampleActions: string[]; userChoices: string[]; count: number }

export interface AuditAggregation {
  totalAudits: number;
  periodDays: number;
  byRuleId: Record<string, { count: number; accepted: number; userChoices: string[] }>;
  byTrigger: Record<string, number>;
  offScript: OffScriptGroup[];
}

const DAY_MS = 24 * 3600 * 1000;

const isOffScript = (e: RuleAuditEntry): boolean => e.trigger === 'manual' || (e.userChoice !== undefined && !e.suggestedActions.includes(e.userChoice));

/** Entries within the last periodDays. accepted = userChoice present and among the suggested actions. */
export function aggregateAudit(entries: readonly RuleAuditEntry[], periodDays: number, now: () => ISODate = nowIso): AuditAggregation {
  const since = toDate(now()).getTime() - periodDays * DAY_MS;
  const recent = entries.filter((e) => toDate(e.at).getTime() >= since);
  const byRuleId: AuditAggregation['byRuleId'] = {};
  const byTrigger: Record<string, number> = {};
  const groups = new Map<string, OffScriptGroup>();
  for (const e of recent) {
    const r = (byRuleId[e.ruleId] ??= { count: 0, accepted: 0, userChoices: [] });
    r.count += 1;
    if (e.userChoice !== undefined) {
      r.userChoices.push(e.userChoice);
      if (e.suggestedActions.includes(e.userChoice)) r.accepted += 1;
    }
    byTrigger[e.trigger] = (byTrigger[e.trigger] ?? 0) + 1;
    if (!isOffScript(e)) continue;
    const key = `${e.trigger}::${JSON.stringify(e.conditionsMatched)}`;
    const g = groups.get(key) ?? { trigger: e.trigger, conditionsMatched: e.conditionsMatched, exampleActions: [], userChoices: [], count: 0 };
    g.count += 1;
    if (!g.exampleActions.includes(e.action)) g.exampleActions.push(e.action);
    if (e.userChoice !== undefined && !g.userChoices.includes(e.userChoice)) g.userChoices.push(e.userChoice);
    groups.set(key, g);
  }
  return { totalAudits: recent.length, periodDays, byRuleId, byTrigger, offScript: [...groups.values()] };
}

export interface LowEngagement<S extends DimensionShape> { rule: Rule<S>; acceptanceRate: number; total: number; commonChoices: string[] }

export const LOW_ENGAGEMENT_RATE = 0.3;
export const DEFAULT_MIN_AUDITS = 3;

/** Rules with at least minAudits entries and acceptance under 30%; commonChoices are the top 3 user choices. */
export function lowEngagementRules<S extends DimensionShape>(agg: AuditAggregation, rules: readonly Rule<S>[], minAudits: number = DEFAULT_MIN_AUDITS): LowEngagement<S>[] {
  const out: LowEngagement<S>[] = [];
  for (const rule of rules) {
    const stats = agg.byRuleId[rule.id];
    if (!stats || stats.count < minAudits) continue;
    const acceptanceRate = stats.accepted / stats.count;
    if (acceptanceRate >= LOW_ENGAGEMENT_RATE) continue;
    const freq = new Map<string, number>();
    for (const c of stats.userChoices) freq.set(c, (freq.get(c) ?? 0) + 1);
    const commonChoices = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([c]) => c);
    out.push({ rule, acceptanceRate, total: stats.count, commonChoices });
  }
  return out;
}

export interface RuleSuggestion<S extends DimensionShape> {
  id: string;
  source: SuggestionSource;
  confidence: number;
  reasoning: string;
  assertion: Assertion;
  rule: Rule<S>;
  existingRuleId?: string;
  evidence: { auditCount: number; periodDays: number; exampleActions: string[]; acceptanceRate?: number };
}

export interface RuleSuggestionResult<S extends DimensionShape> {
  suggestions: RuleSuggestion<S>[];
  bySource: Record<SuggestionSource, number>;
  auditSummary: { totalAudits: number; periodDays: number; uniqueRules: number; uniqueTriggers: number };
  generatedAt: ISODate;
  durationMs: number;
  usage?: Usage;
}

export interface SuggestOptions {
  periodDays?: number;
  maxSuggestions?: number;
  minConfidence?: number;
  category?: string;
  subject?: Ref;
  label?: string;
  clock?: () => number;
}

export const SUGGEST_DEFAULTS = { periodDays: 30, maxSuggestions: 10, minConfidence: 0.5 } as const;
export const SUGGEST_SOURCE = `${RULE_SUGGESTION_PROMPT.name}@${RULE_SUGGESTION_PROMPT.version}`;
export const SUGGESTED_ID_PREFIX = 'suggested-';

function suggestionSchema<S extends DimensionShape>(engine: RuleEngineOptions<S>) {
  return z.object({
    suggestions: z.array(
      z.object({
        source: z.enum(SUGGESTION_SOURCES as [SuggestionSource, ...SuggestionSource[]]),
        confidence: z.number().min(0).max(1),
        reasoning: z.string(),
        rule: parsedRuleFieldsSchema(engine.dims),
        existingRuleId: z.string().optional(),
        evidence: z.object({ auditCount: z.number().int().min(0), exampleActions: z.array(z.string()).default([]) }),
      }),
    ),
  });
}

/** From the audit log: rules for off-script actions and improvements to low-engagement rules. Each suggestion is a proposed assertion. */
export async function suggestRules<S extends DimensionShape>(entries: readonly RuleAuditEntry[], rules: readonly Rule<S>[], engine: RuleEngineOptions<S>, opts: SuggestOptions = {}): Promise<RuleSuggestionResult<S>> {
  const client = requireClient(engine, 'suggestRules');
  const clock = opts.clock ?? (() => Date.now());
  const started = clock();
  const now = engine.now ?? nowIso;
  const periodDays = opts.periodDays ?? SUGGEST_DEFAULTS.periodDays;
  const maxSuggestions = opts.maxSuggestions ?? SUGGEST_DEFAULTS.maxSuggestions;
  const minConfidence = opts.minConfidence ?? SUGGEST_DEFAULTS.minConfidence;
  const scoped = opts.category === undefined ? entries : entries.filter((e) => e.category === opts.category);
  const existing = opts.category === undefined ? rules : rules.filter((r) => r.category === opts.category);
  const agg = aggregateAudit(scoped, periodDays, now);
  const low = lowEngagementRules(agg, existing);
  const auditSummary = { totalAudits: agg.totalAudits, periodDays, uniqueRules: Object.keys(agg.byRuleId).length, uniqueTriggers: Object.keys(agg.byTrigger).length };
  const bySource = Object.fromEntries(SUGGESTION_SOURCES.map((s) => [s, 0])) as Record<SuggestionSource, number>;
  const empty = (): RuleSuggestionResult<S> => ({ suggestions: [], bySource, auditSummary, generatedAt: now(), durationMs: clock() - started });
  if (agg.offScript.length === 0 && low.length === 0) return empty();

  const sections: string[] = [];
  if (agg.offScript.length > 0) sections.push(`## Off-script actions (no rule covered them)\n${JSON.stringify(agg.offScript.slice(0, 20), null, 2)}`);
  if (low.length > 0) {
    sections.push(`## Low-engagement rules (acceptance under 30%)\n${JSON.stringify(low.map((l) => ({ ruleId: l.rule.id, name: l.rule.name, instruction: l.rule.instruction, acceptanceRate: l.acceptanceRate, total: l.total, commonChoices: l.commonChoices })), null, 2)}`);
  }
  sections.push(`## Existing rules (${existing.length})\n${JSON.stringify(existing.map((r) => ({ id: r.id, name: r.name, category: r.category })), null, 2)}`);
  const composed = await composePrompt(RULE_SUGGESTION_PROMPT, { domain: domainOf(engine), dimensions: engine.dims.describe(), categories: engine.categories ?? [] });
  const { value, usage } = await client.generateObject(
    suggestionSchema(engine),
    { model: engine.model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: `Analyze the following audit data from the last ${periodDays} days and suggest rules:\n\n${sections.join('\n\n')}` }], maxTokens: 2048 },
    { ...(opts.label !== undefined ? { label: opts.label } : {}) },
  );

  const suggestions: RuleSuggestion<S>[] = [];
  for (const s of value.suggestions) {
    if (s.confidence < minConfidence) continue;
    if (suggestions.length >= maxSuggestions) break;
    checkCategory(engine, s.rule.category);
    const rule = ruleFromFields(s.rule, { id: `${SUGGESTED_ID_PREFIX}${ruleIdFor(s.rule.category, s.rule.name)}`, confidence: s.confidence, sourceName: SUGGEST_SOURCE, method: 'suggestRules', now });
    const a = assertion({ id: crypto.randomUUID(), subject: opts.subject ?? DEFAULT_RULE_SUBJECT, predicate: 'suggests-rule', object: rule, provenance: rule.provenance });
    const engagement = s.existingRuleId !== undefined ? low.find((l) => l.rule.id === s.existingRuleId) : undefined;
    suggestions.push({
      id: `suggestion-${suggestions.length + 1}`,
      source: s.source,
      confidence: s.confidence,
      reasoning: s.reasoning,
      assertion: a,
      rule,
      ...(s.existingRuleId !== undefined ? { existingRuleId: s.existingRuleId } : {}),
      evidence: { auditCount: s.evidence.auditCount, periodDays, exampleActions: s.evidence.exampleActions, ...(engagement ? { acceptanceRate: engagement.acceptanceRate } : {}) },
    });
    bySource[s.source] += 1;
  }
  return { suggestions, bySource, auditSummary, generatedAt: now(), durationMs: clock() - started, usage };
}
