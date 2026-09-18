import type { ModelClient, ModelRole } from '@apogee/ai';
import type { ISODate } from '@apogee/kernel';
import { createPromptRegistry, definePrompt, fromContext, type PromptRegistry } from '@apogee/prompts';
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

export const GateVerdictSchema = z.object({ passed: z.boolean(), findings: z.array(z.string()) });
export type GateVerdict = z.infer<typeof GateVerdictSchema>;

/** A registry holding every prompt this package sends, for hosts that keep a central registry. */
export function rulesPromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();
  registry.register(GATE_EVALUATION_PROMPT);
  return registry;
}
