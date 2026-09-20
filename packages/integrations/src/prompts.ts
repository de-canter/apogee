import type { ModelClient, ModelRole } from '@de_canter/apogee-ai';
import type { ISODate } from '@de_canter/apogee-kernel';
import { createPromptRegistry, definePrompt, fromContext, type PromptRegistry } from '@de_canter/apogee-prompts';
import { z } from 'zod';

/** The model-facing options the engine shares across executions. */
export interface IntegrationEngineOptions {
  client?: ModelClient;
  /** Phrase for prompts, e.g. 'an equipment rental company'. */
  domain?: string;
  model?: ModelRole;
  now?: () => ISODate;
  clock?: () => number;
}

export const DEFAULT_DOMAIN = 'this application';

export interface DomainPromptCtx { domain: string }

export const POST_PROCESS_PROMPT = definePrompt<DomainPromptCtx>({
  name: 'integrations.post-process',
  version: '1.0.0',
  sections: [
    fromContext('role', (c) => `You turn a REST API response for ${c.domain} into the structured object an administrator described. Use only what the response contains; leave out fields it does not support.`, { stable: true }),
  ],
});

export const CLASSIFY_INBOUND_PROMPT = definePrompt<DomainPromptCtx>({
  name: 'integrations.classify-inbound',
  version: '1.0.0',
  sections: [
    fromContext(
      'role',
      (c) => `You match an inbound webhook for ${c.domain} to one of the candidate integration patterns from its headers and payload. Answer with the pattern id or null, a confidence from 0 to 1, and one sentence of reasoning.`,
      { stable: true },
    ),
  ],
});

export const PostProcessOutputSchema = z.record(z.string(), z.unknown());
export const ClassificationSchema = z.object({ patternId: z.string().nullable(), confidence: z.number().min(0).max(1), reasoning: z.string() });
export type Classification = z.infer<typeof ClassificationSchema>;

export function integrationsPromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();
  registry.register(POST_PROCESS_PROMPT);
  registry.register(CLASSIFY_INBOUND_PROMPT);
  return registry;
}
