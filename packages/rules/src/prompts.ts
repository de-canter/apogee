import type { ModelClient, ModelRole } from '@apogee/ai';
import type { ISODate } from '@apogee/kernel';
import { createPromptRegistry, definePrompt, fromContext, text, type PromptRegistry } from '@apogee/prompts';
import { z } from 'zod';
import type { Dimensions, DimensionShape } from './dimensions';
import { RulesError } from './errors';

/** Everything an LLM-capable rules function needs; the host builds one per dimension set. */
export interface RuleEngineOptions<S extends DimensionShape> {
  dims: Dimensions<S>;
  client?: ModelClient;
  /** Phrase used in prompts, e.g. 'an equipment rental company'. */
  domain?: string;
  categories?: string[];
  model?: ModelRole;
  now?: () => ISODate;
}

export const DEFAULT_DOMAIN = 'this application';

export function requireClient<S extends DimensionShape>(engine: RuleEngineOptions<S>, what: string): ModelClient {
  if (!engine.client) throw new RulesError(`${what} needs a model client`, 'NO_CLIENT');
  return engine.client;
}

export function domainOf<S extends DimensionShape>(engine: RuleEngineOptions<S>): string {
  return engine.domain ?? DEFAULT_DOMAIN;
}

export interface DomainPromptCtx { domain: string }

export const GATE_EVALUATION_PROMPT = definePrompt<DomainPromptCtx>({
  name: 'rules.evaluate-gate',
  version: '1.0.0',
  sections: [
    fromContext(
      'role',
      (c) =>
        `You evaluate whether a subject in ${c.domain} satisfies a set of business rules. Each rule has a name and an instruction written by an administrator. Judge only what the instructions ask; do not invent requirements. Report passed=false only when an instruction is clearly not satisfied by the subject, and put one finding per rule you checked, stating what you verified or what is missing.`,
      { stable: true },
    ),
  ],
});

export interface ParserPromptCtx { domain: string; dimensions: string; categories: string[] }

export const RULE_PARSER_PROMPT = definePrompt<ParserPromptCtx>({
  name: 'rules.parse-rule',
  version: '1.0.0',
  sections: [
    fromContext(
      'role',
      (c) =>
        `You convert natural-language descriptions of business rules into structured rules for ${c.domain}. A rule has conditions (when it applies), an instruction (what an AI assistant must do when it applies), suggested actions the user can take, and optional structured checks that can be verified without judgment.`,
      { stable: true },
    ),
    fromContext(
      'dimensions',
      (c) =>
        `Conditions may only use these dimensions. Each condition lists the allowed values; a rule with no conditions always applies.\n${c.dimensions}\nUse conditions.naturalLanguage only for logic that does not fit a dimension.`,
      { stable: true },
    ),
    fromContext('categories', (c) => (c.categories.length > 0 ? `Categories: ${c.categories.join(', ')}.` : undefined), { stable: true }),
    text(
      'guidelines',
      `Guidelines:
- Only include condition dimensions that are clearly specified or strongly implied.
- Set confidence above 0.9 when the rule is clear and unambiguous, 0.7 to 0.9 when some interpretation was needed, below 0.7 when significant ambiguity exists.
- Add an ambiguity entry for each field where you made an assumption, with the interpretations you considered.
- Always provide at least one suggested action; name actions in snake_case.
- The instruction is a clear directive for an AI assistant; write it in the imperative.
- Use a structured check when the rule can be verified from data (a field must exist, be non-empty, exceed a number, match a pattern, or have a minimum count); use the operators exists, not_empty, eq, neq, gt, gte, lt, lte, matches, min_count, max_count and set severity 'error' when the rule blocks, 'warning' when it only advises.
- Priority is 0 to 1000; default 100; higher runs first.`,
    ),
  ],
});

export const GateVerdictSchema = z.object({ passed: z.boolean(), findings: z.array(z.string()) });
export type GateVerdict = z.infer<typeof GateVerdictSchema>;

/** A registry holding every prompt this package sends, for hosts that keep a central registry. */
export function rulesPromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();
  registry.register(GATE_EVALUATION_PROMPT);
  registry.register(RULE_PARSER_PROMPT);
  return registry;
}
