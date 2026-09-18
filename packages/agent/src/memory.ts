import { nowIso, type ISODate } from '@apogee/kernel';
import type { Contributor } from '@apogee/prompts';
import { z } from 'zod';
import { defineTool, type Tool } from './tool';

/** A persistent design-memory document, read into the prompt and rewritten by the agent. */
export interface MemoryDoc {
  content: string;
  summary: Record<string, unknown>;
  version: number;
  updatedAt: ISODate;
  updatedBy: string;
}

export interface MemoryPatch { content: string; summary?: Record<string, unknown> }

export interface MemoryPort<K> {
  get(key: K): Promise<MemoryDoc | undefined>;
  /** Full replace of content; summary fields merge; version increments. */
  set(key: K, patch: MemoryPatch, by: string): Promise<MemoryDoc>;
}

export function createInMemoryMemory<K>(keyOf: (k: K) => string, now: () => ISODate = nowIso): MemoryPort<K> {
  const docs = new Map<string, MemoryDoc>();
  return {
    get: (key) => Promise.resolve(docs.get(keyOf(key))),
    set(key, patch, by) {
      const k = keyOf(key);
      const cur = docs.get(k);
      const next: MemoryDoc = {
        content: patch.content,
        summary: { ...(cur?.summary ?? {}), ...(patch.summary ?? {}) },
        version: (cur?.version ?? 0) + 1,
        updatedAt: now(),
        updatedBy: by,
      };
      docs.set(k, next);
      return Promise.resolve(next);
    },
  };
}

const MemoryInputSchema = z.object({
  content: z.string().describe('The full updated memory document. This replaces the entire document.'),
  summary: z.record(z.string(), z.unknown()).optional().describe('Optional structured summary fields to merge.'),
});
export type MemoryToolInput = z.infer<typeof MemoryInputSchema>;

export interface MemoryToolOptions<TCtx, K> {
  port: MemoryPort<K>;
  keyFromCtx: (ctx: TCtx) => K | undefined;
  byFromCtx: (ctx: TCtx) => string;
  /** Hard cap on document size; the model must stay under it. */
  maxChars?: number;
  name?: string;
  description?: string;
}

export const DEFAULT_MEMORY_TOOL_DESCRIPTION =
  'Update the persistent design-memory document for this context. It is loaded into your system prompt at the start of every session, so call it proactively whenever a significant decision is made, an open question is resolved, or a pattern is established. Re-emit the entire document; it is replaced wholesale.';

export function memoryTool<TCtx, K>(opts: MemoryToolOptions<TCtx, K>): Tool<TCtx, MemoryToolInput> {
  const maxChars = opts.maxChars ?? 20_000;
  return defineTool<TCtx, MemoryToolInput>({
    name: opts.name ?? 'update_memory',
    description: opts.description ?? DEFAULT_MEMORY_TOOL_DESCRIPTION,
    input: MemoryInputSchema,
    async execute(input, { ctx }) {
      const key = opts.keyFromCtx(ctx);
      if (key === undefined) return { success: false, error: 'No memory key for this session context.' };
      if (input.content.length > maxChars) {
        return { success: false, error: `Memory document is ${input.content.length} chars; the limit is ${maxChars}. Condense it.` };
      }
      const doc = await opts.port.set(key, { content: input.content, ...(input.summary ? { summary: input.summary } : {}) }, opts.byFromCtx(ctx));
      return { success: true, message: `Memory updated (version ${doc.version}).`, data: { version: doc.version } };
    },
  });
}

export interface MemoryContributorOptions<TCtx, K> {
  port: MemoryPort<K>;
  keyFromCtx: (ctx: TCtx) => K | undefined;
  heading?: string;
}

/** Prompt contributor that injects the memory document under a heading. */
export function memoryContributor<TCtx, K>(opts: MemoryContributorOptions<TCtx, K>): Contributor<TCtx> {
  const heading = opts.heading ?? '## Design Memory';
  return async (ctx) => {
    const key = opts.keyFromCtx(ctx);
    if (key === undefined) return undefined;
    const doc = await opts.port.get(key);
    if (!doc || doc.content.trim() === '') return undefined;
    return `${heading}\n\n${doc.content}`;
  };
}
