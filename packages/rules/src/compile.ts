import type { Contributor } from '@apogee/prompts';
import type { DimensionShape, Facts } from './dimensions';
import { findMatchingRules, type Rule, type UnknownFacts } from './rule';

export interface CompiledRules { text: string; ruleIds: string[]; ruleCount: number }

export interface CompileOptions {
  heading?: string;
  intro?: string;
  category?: string;
  /** Default 'pass': a rule conditioned on a fact not yet known is still injected, with its applicability stated. */
  unknownFacts?: UnknownFacts;
}

export const DEFAULT_RULES_HEADING = '## Business rules';

function applicability<S extends DimensionShape>(rule: Rule<S>): string | undefined {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(rule.conditions)) {
    if (k === 'naturalLanguage' || !Array.isArray(v) || v.length === 0) continue;
    parts.push(`${k} is ${v.map(String).join(' or ')}`);
  }
  const nl = rule.conditions.naturalLanguage?.trim();
  if (nl) parts.push(`and ${nl}`);
  return parts.length > 0 ? `Applies when: ${parts.join('; ')}` : undefined;
}

/** `### name`, an applicability line, the instruction, and numbered actions with the default marked. */
export function formatRule<S extends DimensionShape>(rule: Rule<S>): string {
  const parts: string[] = [`### ${rule.name}`];
  const when = applicability(rule);
  if (when) parts.push(when);
  if (rule.instruction.trim() !== '') parts.push(rule.instruction);
  if (rule.suggestedActions.length > 0) {
    const actions = rule.suggestedActions.map((a, i) => `${i + 1}. \`${a}\`${a === rule.defaultAction ? ' (recommended)' : ''}`).join('\n');
    parts.push(`**Available actions:**\n${actions}`);
  }
  return parts.join('\n\n');
}

/** Matching enabled rules, sorted by priority, under a heading; empty when nothing matches. */
export function compileRules<S extends DimensionShape>(rules: readonly Rule<S>[], facts: Facts<S>, opts: CompileOptions = {}): CompiledRules {
  const matched = findMatchingRules(rules, facts, {
    unknownFacts: opts.unknownFacts ?? 'pass',
    ...(opts.category !== undefined ? { category: opts.category } : {}),
  });
  if (matched.length === 0) return { text: '', ruleIds: [], ruleCount: 0 };
  const sections = [opts.heading ?? DEFAULT_RULES_HEADING];
  if (opts.intro) sections.push(opts.intro);
  sections.push(...matched.map(formatRule));
  return { text: sections.join('\n\n'), ruleIds: matched.map((r) => r.id), ruleCount: matched.length };
}

export interface RulesContributorOptions<TCtx, S extends DimensionShape> extends CompileOptions {
  /** The rule source; receives the compose context so a host can scope rules per tenant or visitor. */
  rules: (ctx: TCtx) => readonly Rule<S>[] | Promise<readonly Rule<S>[]>;
  factsFromCtx: (ctx: TCtx) => Facts<S>;
}

/** A `@apogee/prompts` contributor for a `rules` slot: undefined when nothing matches. */
export function rulesContributor<TCtx, S extends DimensionShape>(opts: RulesContributorOptions<TCtx, S>): Contributor<TCtx> {
  const { rules, factsFromCtx, ...compile } = opts;
  return async (ctx) => {
    const compiled = compileRules(await rules(ctx), factsFromCtx(ctx), compile);
    return compiled.ruleCount === 0 ? undefined : compiled.text;
  };
}
