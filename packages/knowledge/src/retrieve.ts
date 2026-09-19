import type { ModelClient, ModelRole, Usage } from '@apogee/ai';
import { composePrompt, createPromptRegistry, definePrompt, fromContext, toSystemBlocks, type Contributor, type PromptRegistry } from '@apogee/prompts';
import type { ChunkStore, ScoredChunk, SearchOptions } from './store';

export interface RetrieveOptions extends SearchOptions {
  heading?: string;
  intro?: string;
  /** Excerpts are appended until this budget would be exceeded. */
  maxChars?: number;
}

export interface Citation { n: number; id: string; source: string; title: string }

export interface Retrieval {
  chunks: ScoredChunk[];
  /** The prompt section; empty when nothing matched. */
  text: string;
  citations: Citation[];
}

export const DEFAULT_HEADING = '## Relevant documentation';
export const DEFAULT_INTRO = 'The following excerpts may help answer the question. Cite the source of anything you use.';
export const DEFAULT_MAX_CHARS = 6000;
export const SEPARATOR = '\n\n---\n\n';

const excerpt = (c: ScoredChunk, n: number): string => `### ${c.title} [${n}]\n_Source: ${c.source}_\n\n${c.content}`;

/** Numbered excerpts with their sources, under a heading; a character budget bounds the section. */
export function formatRetrieval(chunks: readonly ScoredChunk[], opts: RetrieveOptions = {}): Retrieval {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const head = `${opts.heading ?? DEFAULT_HEADING}\n\n${opts.intro ?? DEFAULT_INTRO}`;
  const kept: ScoredChunk[] = [];
  const parts: string[] = [];
  let length = head.length;
  for (const c of chunks) {
    const text = excerpt(c, kept.length + 1);
    if (kept.length > 0 && length + SEPARATOR.length + text.length > maxChars) break;
    kept.push(c);
    parts.push(text);
    length += SEPARATOR.length + text.length;
  }
  if (kept.length === 0) return { chunks: [], text: '', citations: [] };
  return {
    chunks: kept,
    text: `${head}\n\n${parts.join(SEPARATOR)}`,
    citations: kept.map((c, i) => ({ n: i + 1, id: c.id, source: c.source, title: c.title })),
  };
}

export async function retrieve(store: ChunkStore, query: string, opts: RetrieveOptions = {}): Promise<Retrieval> {
  const { heading, intro, maxChars, ...search } = opts;
  const chunks = await store.search(query, search);
  return formatRetrieval(chunks, { ...(heading !== undefined ? { heading } : {}), ...(intro !== undefined ? { intro } : {}), ...(maxChars !== undefined ? { maxChars } : {}) });
}

/** Lifted heuristic: does this message ask for help or an explanation? */
export const HELP_PATTERNS: readonly RegExp[] = [
  /\bhow\s+(do|can|to|does|are|is)\b/i,
  /\bwhat\s+(is|are|does|happens)\b/i,
  /\bwhere\s+(is|can|do|are)\b/i,
  /\bwhen\s+(is|are|do|does|can)\b/i,
  /\bwhy\s+(is|are|do|does)\b/i,
  /\bhelp\b/i,
  /\bexplain\b/i,
  /\bguide\b/i,
  /\bdocumentation\b/i,
  /\bwalkthrough\b/i,
  /\btutorial\b/i,
  /\bshow me how\b/i,
  /\bsteps to\b/i,
  /\binstructions\b/i,
  /\bpolicy\b/i,
  /\?\s*$/,
];

export function isHelpQuery(text: string): boolean {
  return HELP_PATTERNS.some((p) => p.test(text));
}

export interface KnowledgeContributorOptions<TCtx> extends RetrieveOptions {
  store: ChunkStore;
  queryFromCtx: (ctx: TCtx) => string | undefined;
  scopeFromCtx?: (ctx: TCtx) => string | string[] | undefined;
  /** Retrieve only when this passes; default isHelpQuery. Pass () => true to always retrieve. */
  when?: (query: string) => boolean;
}

/** A `@apogee/prompts` contributor: excerpts for the context's question, or nothing. */
export function knowledgeContributor<TCtx>(opts: KnowledgeContributorOptions<TCtx>): Contributor<TCtx> {
  const { store, queryFromCtx, scopeFromCtx, when, ...retrieveOpts } = opts;
  const gate = when ?? isHelpQuery;
  return async (ctx) => {
    const query = queryFromCtx(ctx);
    if (query === undefined || query.trim() === '' || !gate(query)) return undefined;
    const scope = scopeFromCtx?.(ctx);
    const r = await retrieve(store, query, { ...retrieveOpts, ...(scope !== undefined ? { scope } : {}) });
    return r.chunks.length === 0 ? undefined : r.text;
  };
}

export interface AnswerPromptCtx { domain: string }

export const ANSWER_PROMPT = definePrompt<AnswerPromptCtx>({
  name: 'knowledge.answer',
  version: '1.0.0',
  sections: [
    fromContext(
      'role',
      (c) =>
        `You answer questions about ${c.domain} using only the documentation excerpts provided. Cite each excerpt you use by its number in square brackets, like [1]. If the excerpts do not answer the question, say so and do not invent an answer.`,
      { stable: true },
    ),
  ],
});

export const DEFAULT_DOMAIN = 'this application';
export const NO_MATCH = 'No documentation matched.';

export interface Answer { text: string; retrieval: Retrieval; usage: Usage }

export interface AnswerOptions extends RetrieveOptions {
  client: ModelClient;
  domain?: string;
  model?: ModelRole;
  label?: string;
}

/** Retrieve, then ask the model to answer from the excerpts with citations. */
export async function answer(store: ChunkStore, question: string, opts: AnswerOptions): Promise<Answer> {
  const { client, domain, model, label, ...retrieveOpts } = opts;
  const retrieval = await retrieve(store, question, retrieveOpts);
  const composed = await composePrompt(ANSWER_PROMPT, { domain: domain ?? DEFAULT_DOMAIN });
  const result = await client.generate(
    { model: model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: `${retrieval.text || NO_MATCH}\n\nQuestion: ${question}` }], maxTokens: 1024 },
    { ...(label !== undefined ? { label } : {}) },
  );
  return { text: result.text, retrieval, usage: result.usage };
}

export function knowledgePromptRegistry(): PromptRegistry {
  const registry = createPromptRegistry();
  registry.register(ANSWER_PROMPT);
  return registry;
}
