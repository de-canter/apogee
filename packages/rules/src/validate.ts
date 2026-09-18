import type { Usage } from '@apogee/ai';
import { composePrompt, toSystemBlocks } from '@apogee/prompts';
import type { Dimensions, DimensionShape } from './dimensions';
import { AiFindingsSchema, domainOf, requireClient, RULE_VALIDATOR_PROMPT, type RuleEngineOptions } from './prompts';
import { conditionsIdentical, conditionsNarrower, conditionsOverlap, ruleSchema, type CheckOperator, type Rule } from './rule';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface RuleDiagnostic {
  /** S0xx structural, C0xx cross-rule, A0xx AI. */
  code: string;
  ruleId: string;
  severity: DiagnosticSeverity;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface RuleValidationResult {
  /** No error-severity diagnostics. */
  valid: boolean;
  diagnostics: RuleDiagnostic[];
  summary: { errors: number; warnings: number; info: number };
  aiChecksPerformed: boolean;
  usage?: Usage;
}

export interface ValidateOptions<S extends DimensionShape> { others?: readonly Rule<S>[]; ai?: boolean; label?: string }

const OPERATORS_NEEDING_VALUE: readonly CheckOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'matches', 'min_count', 'max_count'];
export const HIGH_PRIORITY_UNCONDITIONAL = 500;
export const SHORT_INSTRUCTION = 50;
export const SHORT_ACTION = 5;

function isUnconditional<S extends DimensionShape>(rule: Rule<S>): boolean {
  return Object.entries(rule.conditions).every(([k, v]) => k === 'naturalLanguage' ? !v : !Array.isArray(v) || v.length === 0);
}

export function structuralDiagnostics<S extends DimensionShape>(rule: Rule<S>, dims: Dimensions<S>): RuleDiagnostic[] {
  const out: RuleDiagnostic[] = [];
  const d = (code: string, severity: DiagnosticSeverity, message: string, extra: { field?: string; suggestion?: string } = {}): void => {
    out.push({ code, ruleId: rule.id, severity, message, ...extra });
  };
  const parsed = ruleSchema(dims).safeParse(rule);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) d('S001', 'error', `Schema validation: ${issue.path.join('.')}: ${issue.message}`, { field: issue.path.join('.') });
  }
  if (rule.defaultAction !== undefined && rule.suggestedActions.length > 0 && !rule.suggestedActions.includes(rule.defaultAction)) {
    d('S002', 'warning', `Default action "${rule.defaultAction}" is not one of the suggested actions`, { field: 'defaultAction' });
  }
  if (isUnconditional(rule) && rule.priority >= HIGH_PRIORITY_UNCONDITIONAL) {
    d('S003', 'warning', `Unconditional rule with priority ${rule.priority} will lead every prompt`, { field: 'priority', suggestion: 'Add conditions or lower the priority' });
  }
  for (const [k, v] of Object.entries(rule.conditions)) {
    if (k !== 'naturalLanguage' && Array.isArray(v) && v.length === 0) d('S004', 'warning', `Condition "${k}" is an empty list, which matches everything`, { field: `conditions.${k}` });
  }
  if (rule.instruction.length < SHORT_INSTRUCTION) d('S005', 'info', 'Instruction is very short; the assistant may not know what to do', { field: 'instruction' });
  if (rule.suggestedActions.some((a) => a.length < SHORT_ACTION)) d('S006', 'info', 'A suggested action name is very short', { field: 'suggestedActions' });
  if (rule.description.trim() === '') d('S008', 'info', 'No description', { field: 'description' });
  if (new Set(rule.suggestedActions).size !== rule.suggestedActions.length) d('S009', 'warning', 'Duplicate suggested actions', { field: 'suggestedActions' });
  rule.structuredChecks.forEach((c, i) => {
    if (OPERATORS_NEEDING_VALUE.includes(c.check) && c.value === undefined) d('S010', 'warning', `Check "${c.field} ${c.check}" needs a value`, { field: `structuredChecks.${i}.value` });
  });
  return out;
}

export function crossRuleDiagnostics<S extends DimensionShape>(rule: Rule<S>, others: readonly Rule<S>[]): RuleDiagnostic[] {
  const out: RuleDiagnostic[] = [];
  const d = (code: string, severity: DiagnosticSeverity, message: string): void => {
    out.push({ code, ruleId: rule.id, severity, message });
  };
  for (const other of others) {
    if (other === rule) continue;
    if (other.id === rule.id) d('C001', 'error', `Another rule has the id "${rule.id}"`);
    if (other.category !== rule.category || !rule.enabled || !other.enabled) continue;
    const identical = conditionsIdentical(rule.conditions, other.conditions);
    if (identical) d('C002', 'warning', `Identical conditions to "${other.id}"`);
    if (identical && rule.priority === other.priority) d('C004', 'warning', `Same priority as "${other.id}" with identical conditions; ordering is undefined`);
    if (!identical && conditionsNarrower(rule.conditions, other.conditions)) d('C003', 'info', `Conditions are narrower than "${other.id}", which may shadow this rule`);
  }
  return out;
}

export function summarize(diagnostics: readonly RuleDiagnostic[]): RuleValidationResult['summary'] {
  return {
    errors: diagnostics.filter((x) => x.severity === 'error').length,
    warnings: diagnostics.filter((x) => x.severity === 'warning').length,
    info: diagnostics.filter((x) => x.severity === 'info').length,
  };
}

function buildResult(diagnostics: RuleDiagnostic[], aiChecksPerformed: boolean, usage?: Usage): RuleValidationResult {
  const summary = summarize(diagnostics);
  return { valid: summary.errors === 0, diagnostics, summary, aiChecksPerformed, ...(usage ? { usage } : {}) };
}

async function aiDiagnostics<S extends DimensionShape>(rule: Rule<S>, others: readonly Rule<S>[], engine: RuleEngineOptions<S>, label?: string): Promise<{ diagnostics: RuleDiagnostic[]; usage: Usage }> {
  const client = requireClient(engine, 'validateRule with ai');
  const overlapping = others.filter((o) => o !== rule && o.id !== rule.id && o.category === rule.category && o.enabled && conditionsOverlap(rule.conditions, o.conditions));
  const composed = await composePrompt(RULE_VALIDATOR_PROMPT, { domain: domainOf(engine) });
  const user = `Target rule:\n${JSON.stringify(rule, null, 2)}\n\n${overlapping.length > 0 ? `Overlapping rules in the same category:\n${JSON.stringify(overlapping, null, 2)}` : 'No overlapping rules.'}`;
  const { value, usage } = await client.generateObject(
    AiFindingsSchema,
    { model: engine.model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: user }], maxTokens: 1024 },
    { ...(label !== undefined ? { label } : {}) },
  );
  return {
    diagnostics: value.findings.map((f) => ({ code: f.code, ruleId: rule.id, severity: f.severity, message: f.message, ...(f.field !== undefined ? { field: f.field } : {}), ...(f.suggestion !== undefined ? { suggestion: f.suggestion } : {}) })),
    usage,
  };
}

/** Structural and cross-rule checks always; AI semantic checks on request. */
export async function validateRule<S extends DimensionShape>(rule: Rule<S>, engine: RuleEngineOptions<S>, opts: ValidateOptions<S> = {}): Promise<RuleValidationResult> {
  const others = opts.others ?? [];
  const diagnostics = [...structuralDiagnostics(rule, engine.dims), ...crossRuleDiagnostics(rule, others)];
  if (!opts.ai) return buildResult(diagnostics, false);
  const ai = await aiDiagnostics(rule, others, engine, opts.label);
  return buildResult([...diagnostics, ...ai.diagnostics], true, ai.usage);
}

/** Each rule against the others; a duplicated id is reported once per id. */
export async function validateRules<S extends DimensionShape>(rules: readonly Rule<S>[], engine: RuleEngineOptions<S>, opts: Omit<ValidateOptions<S>, 'others'> = {}): Promise<RuleValidationResult> {
  const diagnostics: RuleDiagnostic[] = [];
  const dupes = new Set<string>();
  let performed = false;
  let usage: Usage | undefined;
  for (const rule of rules) {
    const result = await validateRule(rule, engine, { ...opts, others: rules });
    for (const d of result.diagnostics) {
      if (d.code === 'C001') {
        if (dupes.has(d.ruleId)) continue;
        dupes.add(d.ruleId);
      }
      diagnostics.push(d);
    }
    performed ||= result.aiChecksPerformed;
    if (result.usage) usage = usage ? { ...result.usage, input: usage.input + result.usage.input, output: usage.output + result.usage.output, cacheRead: usage.cacheRead + result.usage.cacheRead, cacheWrite: usage.cacheWrite + result.usage.cacheWrite, costUsd: usage.costUsd + result.usage.costUsd } : result.usage;
  }
  return buildResult(diagnostics, performed, usage);
}
