import type { Usage } from '@apogee/ai';
import { nowIso, type ISODate } from '@apogee/kernel';
import { composePrompt, toSystemBlocks } from '@apogee/prompts';
import type { DimensionShape } from './dimensions';
import { AiConflictsSchema, domainOf, requireClient, RULE_CONFLICT_PROMPT, type RuleEngineOptions } from './prompts';
import { conditionsIdentical, conditionsNarrower, conditionsOverlap, normalizeConditions, type Rule } from './rule';
import type { DiagnosticSeverity } from './validate';

export type ConflictType = 'identical_conditions' | 'subset_superset' | 'conflicting_instructions' | 'priority_collision' | 'redundant_rule';
export const CONFLICT_TYPES: readonly ConflictType[] = ['identical_conditions', 'subset_superset', 'conflicting_instructions', 'priority_collision', 'redundant_rule'];
export type ResolutionAction = 'adjust_priority' | 'merge_rules' | 'disable_rule' | 'differentiate_conditions';

export interface ConflictResolution { action: ResolutionAction; description: string; targetRuleIds: string[]; suggestedValues?: Record<string, unknown> }

export interface RuleConflict {
  id: string;
  type: ConflictType;
  severity: DiagnosticSeverity;
  description: string;
  ruleIds: [string, string];
  ruleNames: [string, string];
  category: string;
  overlappingConditions?: Record<string, unknown>;
  resolutions: ConflictResolution[];
  aiExplanation?: string;
}

export interface ConflictReport {
  conflicts: RuleConflict[];
  totalConflicts: number;
  byType: Record<ConflictType, number>;
  rulesAnalyzed: number;
  aiAnalysisPerformed: boolean;
  summary: string;
  generatedAt: ISODate;
  durationMs: number;
  usage?: Usage;
}

export interface ConflictOptions { category?: string; includeDisabled?: boolean; ruleIds?: string[]; ai?: boolean; label?: string; clock?: () => number }

const SEVERITY: Record<ConflictType, DiagnosticSeverity> = {
  identical_conditions: 'warning',
  subset_superset: 'info',
  conflicting_instructions: 'warning',
  priority_collision: 'warning',
  redundant_rule: 'info',
};

export const PRIORITY_BUMP = 10;

export function resolutionsFor(conflict: Pick<RuleConflict, 'type' | 'ruleIds'> & { priority?: number }): ConflictResolution[] {
  const [first, second] = conflict.ruleIds;
  const both = [first, second];
  switch (conflict.type) {
    case 'identical_conditions':
      return [
        { action: 'adjust_priority', description: 'Give the rules different priorities so their order is explicit', targetRuleIds: both },
        { action: 'merge_rules', description: 'Merge the two instructions into one rule', targetRuleIds: both },
        { action: 'disable_rule', description: `Disable "${second}"`, targetRuleIds: [second] },
      ];
    case 'subset_superset':
      return [
        { action: 'adjust_priority', description: 'Give the narrower rule higher priority so it is listed first', targetRuleIds: both },
        { action: 'differentiate_conditions', description: 'Change the conditions so the rules no longer nest', targetRuleIds: both },
      ];
    case 'conflicting_instructions':
      return [
        { action: 'merge_rules', description: 'Rewrite the two instructions as one consistent rule', targetRuleIds: both },
        { action: 'disable_rule', description: `Disable "${second}"`, targetRuleIds: [second] },
        { action: 'differentiate_conditions', description: 'Narrow one rule so they never apply together', targetRuleIds: both },
      ];
    case 'priority_collision': {
      const base = conflict.priority ?? 100;
      return [{ action: 'adjust_priority', description: 'Separate the priorities', targetRuleIds: both, suggestedValues: { [first]: base + PRIORITY_BUMP, [second]: base } }];
    }
    case 'redundant_rule':
      return [
        { action: 'disable_rule', description: `Disable "${second}"`, targetRuleIds: [second] },
        { action: 'merge_rules', description: 'Keep one rule with the clearer wording', targetRuleIds: both },
      ];
  }
}

function conflict(counter: { n: number }, type: ConflictType, a: Rule<DimensionShape>, b: Rule<DimensionShape>, description: string, extra: Partial<RuleConflict> = {}): RuleConflict {
  counter.n += 1;
  return {
    id: `conflict-${counter.n}`,
    type,
    severity: SEVERITY[type],
    description,
    ruleIds: [a.id, b.id],
    ruleNames: [a.name, b.name],
    category: a.category,
    resolutions: resolutionsFor({ type, ruleIds: [a.id, b.id], priority: a.priority }),
    ...extra,
  };
}

export interface DeterministicOptions { includeDisabled?: boolean; counter?: { n: number } }

/** Pairwise within a category, enabled rules only unless includeDisabled: priority collisions, identical conditions, nested conditions. */
export function deterministicConflicts<S extends DimensionShape>(rules: readonly Rule<S>[], opts: DeterministicOptions = {}): RuleConflict[] {
  const counter = opts.counter ?? { n: 0 };
  const out: RuleConflict[] = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (a.category !== b.category) continue;
      if (!opts.includeDisabled && (!a.enabled || !b.enabled)) continue;
      if (conditionsIdentical(a.conditions, b.conditions)) {
        const overlappingConditions = normalizeConditions(a.conditions);
        if (a.priority === b.priority) out.push(conflict(counter, 'priority_collision', a, b, `"${a.id}" and "${b.id}" have identical conditions and the same priority (${a.priority}); their order is undefined`, { overlappingConditions }));
        else out.push(conflict(counter, 'identical_conditions', a, b, `"${a.id}" and "${b.id}" have identical conditions`, { overlappingConditions }));
        continue;
      }
      const aNarrower = conditionsNarrower(a.conditions, b.conditions);
      const bNarrower = conditionsNarrower(b.conditions, a.conditions);
      if (aNarrower || bNarrower) {
        const [narrow, broad] = aNarrower ? [a, b] : [b, a];
        out.push(conflict(counter, 'subset_superset', a, b, `"${narrow.id}" is narrower than "${broad.id}": whenever it applies, both apply`, { overlappingConditions: normalizeConditions(narrow.conditions) }));
      }
    }
  }
  return out;
}

const pairText = <S extends DimensionShape>(r: Rule<S>): string => JSON.stringify({ id: r.id, name: r.name, conditions: r.conditions, instruction: r.instruction });

async function aiConflicts<S extends DimensionShape>(rules: readonly Rule<S>[], engine: RuleEngineOptions<S>, counter: { n: number }, label?: string): Promise<{ conflicts: RuleConflict[]; usage?: Usage }> {
  const client = requireClient(engine, 'detectConflicts with ai');
  const byCategory = new Map<string, Rule<S>[]>();
  for (const r of rules) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  const out: RuleConflict[] = [];
  let usage: Usage | undefined;
  const byId = new Map(rules.map((r) => [r.id, r]));
  for (const [category, group] of byCategory) {
    const pairs: Array<[Rule<S>, Rule<S>]> = [];
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) if (conditionsOverlap(group[i]!.conditions, group[j]!.conditions)) pairs.push([group[i]!, group[j]!]);
    if (pairs.length === 0) continue;
    const composed = await composePrompt(RULE_CONFLICT_PROMPT, { domain: domainOf(engine) });
    const user = `Overlapping rule pairs in the "${category}" category:\n\n${pairs.map(([a, b]) => `Pair:\nRule A: ${pairText(a)}\nRule B: ${pairText(b)}`).join('\n\n')}`;
    const result = await client.generateObject(
      AiConflictsSchema,
      { model: engine.model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: user }], maxTokens: 1024 },
      { ...(label !== undefined ? { label } : {}) },
    );
    usage = usage ? { ...result.usage, input: usage.input + result.usage.input, output: usage.output + result.usage.output, cacheRead: usage.cacheRead + result.usage.cacheRead, cacheWrite: usage.cacheWrite + result.usage.cacheWrite, costUsd: usage.costUsd + result.usage.costUsd } : result.usage;
    for (const f of result.value.conflicts) {
      const a = byId.get(f.ruleIds[0]);
      const b = byId.get(f.ruleIds[1]);
      if (!a || !b) continue;
      out.push(conflict(counter, f.type, a, b, f.description, { aiExplanation: f.explanation }));
    }
  }
  return { conflicts: out, ...(usage ? { usage } : {}) };
}

function summarize(conflicts: readonly RuleConflict[], byType: Record<ConflictType, number>, n: number): string {
  if (conflicts.length === 0) return `No conflicts among ${n} rules.`;
  const parts = [...CONFLICT_TYPES].sort().filter((t) => byType[t] > 0).map((t) => `${byType[t]} ${t}`);
  return `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} among ${n} rules: ${parts.join(', ')}`;
}

export async function detectConflicts<S extends DimensionShape>(rules: readonly Rule<S>[], engine: RuleEngineOptions<S>, opts: ConflictOptions = {}): Promise<ConflictReport> {
  const clock = opts.clock ?? (() => Date.now());
  const started = clock();
  const ids = opts.ruleIds ? new Set(opts.ruleIds) : undefined;
  const analyzed = rules.filter((r) => (opts.includeDisabled || r.enabled) && (opts.category === undefined || r.category === opts.category) && (ids === undefined || ids.has(r.id)));
  const counter = { n: 0 };
  const conflicts = deterministicConflicts(analyzed, { includeDisabled: true, counter });
  let usage: Usage | undefined;
  if (opts.ai) {
    const ai = await aiConflicts(analyzed, engine, counter, opts.label);
    conflicts.push(...ai.conflicts);
    usage = ai.usage;
  }
  const byType = Object.fromEntries(CONFLICT_TYPES.map((t) => [t, conflicts.filter((c) => c.type === t).length])) as Record<ConflictType, number>;
  return {
    conflicts,
    totalConflicts: conflicts.length,
    byType,
    rulesAnalyzed: analyzed.length,
    aiAnalysisPerformed: opts.ai === true,
    summary: summarize(conflicts, byType, analyzed.length),
    generatedAt: (engine.now ?? nowIso)(),
    durationMs: clock() - started,
    ...(usage ? { usage } : {}),
  };
}
