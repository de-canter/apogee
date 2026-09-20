import type { ModelClient, ModelRole } from '@de_canter/apogee-ai';
import type { ISODate } from '@de_canter/apogee-kernel';
import { createPromptRegistry, definePrompt, fromContext, text, type PromptRegistry } from '@de_canter/apogee-prompts';
import { z } from 'zod';
import type { ConfidenceBands } from './confidence';
import { DocumentsError } from './errors';
import type { Taxonomy } from './taxonomy';

/** Everything classify and extract need; the host builds one per taxonomy. */
export interface DocumentEngineOptions<C extends string> {
  client?: ModelClient;
  taxonomy: Taxonomy<C>;
  /** Phrase for prompts, e.g. 'an equipment rental company'. */
  domain?: string;
  /** Overrides the role chosen from the input kind ('vision' for media, 'default' for text). */
  model?: ModelRole;
  bands?: ConfidenceBands;
  now?: () => ISODate;
  clock?: () => number;
}

export const DEFAULT_DOMAIN = 'this application';

export function requireClient<C extends string>(engine: DocumentEngineOptions<C>, what: string): ModelClient {
  if (!engine.client) throw new DocumentsError(`${what} needs a model client`, 'NO_CLIENT');
  return engine.client;
}

export function domainOf<C extends string>(engine: DocumentEngineOptions<C>): string {
  return engine.domain ?? DEFAULT_DOMAIN;
}

export interface ClassifyPromptCtx { domain: string; taxonomy: string }

export const CLASSIFY_PROMPT = definePrompt<ClassifyPromptCtx>({
  name: 'documents.classify',
  version: '1.0.0',
  sections: [
    fromContext(
      'role',
      (c) =>
        `You classify documents for ${c.domain}. Choose the single best type code from the list; use "unknown" when none fits or the content is unreadable. Confidence is your certainty in the choice: above 0.9 when the type is unmistakable, 0.7 to 0.9 when it is likely, below 0.7 when you are guessing. Give a one-sentence reasoning.`,
      { stable: true },
    ),
    fromContext('taxonomy', (c) => `Document types:\n${c.taxonomy}`, { stable: true }),
  ],
});

export function classifyOutputSchema<C extends string>(taxonomy: Taxonomy<C>) {
  return z.object({ code: taxonomy.codeSchema, confidence: z.number().min(0).max(1), reasoning: z.string() });
}

export interface ExtractPromptCtx { domain: string; typeLabel: string; instructions: string; fields: string }

export const EXTRACT_PROMPT = definePrompt<ExtractPromptCtx>({
  name: 'documents.extract',
  version: '1.0.0',
  sections: [
    fromContext('role', (c) => `You extract structured data from documents for ${c.domain}. This document is: ${c.typeLabel}.`, { stable: true }),
    text(
      'guidelines',
      `Guidelines:
1. Extract only what is visible; omit a field rather than guessing.
2. Give each field a confidence from 0.0 to 1.0 for how clearly you could read it: 0.9 to 1.0 clearly visible, 0.7 to 0.89 readable but worth verifying, below 0.7 uncertain.
3. Dates in ISO format (YYYY-MM-DD); amounts as numbers without symbols; names as written.
4. List anything unusual (missing pages, handwriting, conflicting values) as a warning.`,
    ),
    fromContext('fields', (c) => `Fields:\n${c.fields}`, { stable: true }),
    fromContext('instructions', (c) => (c.instructions.trim() === '' ? undefined : `Instructions:\n${c.instructions}`), { stable: true }),
  ],
});

/** Every prompt this package sends, for hosts that keep a central registry. */
export function documentsPromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();
  registry.register(CLASSIFY_PROMPT);
  registry.register(EXTRACT_PROMPT);
  return registry;
}
