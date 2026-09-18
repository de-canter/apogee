import { evaluateChecks, type CheckResult } from './checks';
import { compileRules, type CompiledRules } from './compile';
import type { Dimensions, DimensionShape, Facts } from './dimensions';
import { findMatchingRules, matchedConditions, type Rule } from './rule';
import { crossRuleDiagnostics, structuralDiagnostics, type RuleDiagnostic } from './validate';

export interface Scenario<S extends DimensionShape> {
  id: string;
  name: string;
  description?: string;
  facts: Facts<S>;
  /** When present, each matched rule's structured checks are evaluated against it. */
  subject?: unknown;
  tags?: string[];
}

export interface SimulationMatch {
  ruleId: string;
  name: string;
  category: string;
  priority: number;
  instruction: string;
  matchedConditions: Record<string, unknown>;
  checks?: CheckResult[];
}

export interface SimulationResult<S extends DimensionShape> {
  scenarioId: string;
  scenarioName: string;
  facts: Facts<S>;
  matched: SimulationMatch[];
  totalRulesEvaluated: number;
  compiled: CompiledRules;
  diagnostics?: RuleDiagnostic[];
  durationMs: number;
}

export interface SimulateOptions<S extends DimensionShape> {
  dims: Dimensions<S>;
  ruleIds?: string[];
  validate?: boolean;
  category?: string;
  clock?: () => number;
}

/** Deterministic, no model: which rules match each scenario, their checks against the subject, and the compiled section. */
export function simulate<S extends DimensionShape>(rules: readonly Rule<S>[], scenarios: readonly Scenario<S>[], opts: SimulateOptions<S>): SimulationResult<S>[] {
  const clock = opts.clock ?? (() => Date.now());
  const ids = opts.ruleIds ? new Set(opts.ruleIds) : undefined;
  const candidates = rules.filter((r) => r.enabled && (opts.category === undefined || r.category === opts.category) && (ids === undefined || ids.has(r.id)));
  return scenarios.map((scenario) => {
    const started = clock();
    const matched = findMatchingRules(candidates, scenario.facts);
    const matches: SimulationMatch[] = matched.map((r) => ({
      ruleId: r.id,
      name: r.name,
      category: r.category,
      priority: r.priority,
      instruction: r.instruction,
      matchedConditions: matchedConditions(r, scenario.facts),
      ...(scenario.subject !== undefined ? { checks: evaluateChecks(r.structuredChecks, scenario.subject) } : {}),
    }));
    const compiled = compileRules(matched, scenario.facts, { unknownFacts: 'fail' });
    const diagnostics = opts.validate ? matched.flatMap((r) => [...structuralDiagnostics(r, opts.dims), ...crossRuleDiagnostics(r, matched)]) : undefined;
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      facts: scenario.facts,
      matched: matches,
      totalRulesEvaluated: candidates.length,
      compiled,
      ...(diagnostics ? { diagnostics } : {}),
      durationMs: clock() - started,
    };
  });
}
