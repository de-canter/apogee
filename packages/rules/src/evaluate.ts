import type { Usage } from '@apogee/ai';
import { nowIso, type ISODate } from '@apogee/kernel';
import { composePrompt, toSystemBlocks } from '@apogee/prompts';
import { evaluateChecks, type CheckResult } from './checks';
import type { DimensionShape, Facts } from './dimensions';
import { domainOf, GATE_EVALUATION_PROMPT, GateVerdictSchema, type GateVerdict, type RuleEngineOptions } from './prompts';
import { matchesConditions, type Rule } from './rule';

export type DecidedBy = 'disabled' | 'conditions' | 'checks' | 'instruction';

export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  passed: boolean;
  decidedBy: DecidedBy;
  checks: CheckResult[];
  errors: CheckResult[];
  warnings: CheckResult[];
  findings: string[];
}

export interface GateEvaluation {
  passed: boolean;
  gate?: string;
  matched: number;
  results: RuleEvaluation[];
  errors: CheckResult[];
  warnings: CheckResult[];
  ai?: GateVerdict & { usage: Usage };
  evaluatedAt: ISODate;
}

export interface EvaluateOptions<S extends DimensionShape> {
  facts: Facts<S>;
  subject?: unknown;
  /** What the model sees; default the subject itself. */
  describeSubject?: (subject: unknown) => unknown;
  label?: string;
}

function structuralLayer<S extends DimensionShape>(rule: Rule<S>, opts: EvaluateOptions<S>): RuleEvaluation {
  const base = { ruleId: rule.id, ruleName: rule.name, checks: [], errors: [], warnings: [], findings: [] };
  if (!rule.enabled) return { ...base, matched: false, passed: true, decidedBy: 'disabled' };
  if (!matchesConditions(rule.conditions, opts.facts)) return { ...base, matched: false, passed: true, decidedBy: 'conditions' };
  const checks = evaluateChecks(rule.structuredChecks, opts.subject);
  const errors = checks.filter((c) => !c.passed && c.severity === 'error');
  const warnings = checks.filter((c) => !c.passed && c.severity === 'warning');
  return { ...base, matched: true, passed: errors.length === 0, decidedBy: 'checks', checks, errors, warnings };
}

/**
 * Layer 1: conditions and structured checks, deterministic. Layer 2: one model call over the
 * matched rules' instructions, only when no check failed with error severity and a client is set.
 * Model errors propagate: a gate never fails open silently.
 */
export async function evaluateGate<S extends DimensionShape>(rules: readonly Rule<S>[], engine: RuleEngineOptions<S>, opts: EvaluateOptions<S>): Promise<GateEvaluation> {
  const results = rules.map((r) => structuralLayer(r, opts));
  const matchedRules = rules.filter((_, i) => results[i]!.matched);
  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);
  const instructed = matchedRules.filter((r) => r.instruction.trim() !== '');
  let ai: GateEvaluation['ai'];

  if (errors.length === 0 && engine.client && instructed.length > 0) {
    const composed = await composePrompt(GATE_EVALUATION_PROMPT, { domain: domainOf(engine) });
    const describe = opts.describeSubject ?? ((s: unknown) => s);
    const user = `Rules:\n${instructed.map((r) => `- ${r.name}: ${r.instruction}`).join('\n')}\n\nSubject:\n${JSON.stringify(describe(opts.subject), null, 2)}`;
    const { value, usage } = await engine.client.generateObject(
      GateVerdictSchema,
      { model: engine.model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: user }], maxTokens: 1024 },
      { ...(opts.label !== undefined ? { label: opts.label } : {}) },
    );
    ai = { ...value, usage };
    const instructedIds = new Set(instructed.map((r) => r.id));
    for (const r of results) {
      if (!instructedIds.has(r.ruleId)) continue;
      r.decidedBy = 'instruction';
      r.passed = value.passed;
      r.findings = [...value.findings];
    }
  }

  const gate = matchedRules.find((r) => r.gate !== undefined)?.gate;
  return {
    passed: errors.length === 0 && (ai?.passed ?? true),
    ...(gate !== undefined ? { gate } : {}),
    matched: matchedRules.length,
    results,
    errors,
    warnings,
    ...(ai ? { ai } : {}),
    evaluatedAt: (engine.now ?? nowIso)(),
  };
}

export async function evaluateRule<S extends DimensionShape>(rule: Rule<S>, engine: RuleEngineOptions<S>, opts: EvaluateOptions<S>): Promise<RuleEvaluation> {
  const gate = await evaluateGate([rule], engine, opts);
  return gate.results[0]!;
}
