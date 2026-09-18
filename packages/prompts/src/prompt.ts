export type Section<TCtx> =
  | { id: string; kind: 'text'; text: string; stable: boolean }
  | { id: string; kind: 'context'; render: (ctx: TCtx) => string | undefined; stable: boolean }
  | { id: string; kind: 'slot'; slot: string; stable: boolean };

export interface SectionOptions { stable?: boolean }

/** Static text. Stable by default: it belongs in the cacheable prefix. */
export function text<TCtx = unknown>(id: string, str: string, opts: SectionOptions = {}): Section<TCtx> {
  return { id, kind: 'text', text: str, stable: opts.stable ?? true };
}
/** Rendered from the compose context. Volatile by default. */
export function fromContext<TCtx>(id: string, render: (ctx: TCtx) => string | undefined, opts: SectionOptions = {}): Section<TCtx> {
  return { id, kind: 'context', render, stable: opts.stable ?? false };
}
/** Filled by a contributor at compose time (rules, retrieved knowledge, memory). Volatile by default. */
export function slot<TCtx = unknown>(id: string, slotName: string, opts: SectionOptions = {}): Section<TCtx> {
  return { id, kind: 'slot', slot: slotName, stable: opts.stable ?? false };
}

export interface Prompt<TCtx> {
  name: string;
  version: string;
  sections: Section<TCtx>[];
}

export class PromptDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptDefinitionError';
  }
}

const VERSION = /^\d+\.\d+\.\d+$/;

export function definePrompt<TCtx>(p: Prompt<TCtx>): Prompt<TCtx> {
  if (p.name.length === 0) throw new PromptDefinitionError('prompt name is required');
  if (!VERSION.test(p.version)) throw new PromptDefinitionError(`prompt version must be x.y.z, got ${p.version}`);
  const ids = new Set<string>();
  for (const s of p.sections) {
    if (ids.has(s.id)) throw new PromptDefinitionError(`duplicate section id: ${s.id}`);
    ids.add(s.id);
  }
  return { name: p.name, version: p.version, sections: [...p.sections] };
}

export type Contributor<TCtx> = (ctx: TCtx) => string | undefined | Promise<string | undefined>;

export interface ComposedBlock { id: string; text: string; cache: boolean }
export interface ComposedPrompt {
  name: string;
  version: string;
  blocks: ComposedBlock[];
  /** Index of the first volatile block. Everything before it is the cacheable prefix. */
  cacheBoundary: number;
  /** All blocks joined with the separator, for callers that want one string. */
  text: string;
}

export interface ComposeOptions<TCtx> {
  contributors?: Record<string, Contributor<TCtx>>;
  separator?: string;
}

export const DEFAULT_SEPARATOR = '\n\n---\n\n';

/**
 * Render sections in declaration order, drop empty ones, and place one cache
 * breakpoint at the end of the leading run of stable blocks. Stable sections
 * declared after a volatile one are not cached: caching is a prefix match.
 */
export async function composePrompt<TCtx>(prompt: Prompt<TCtx>, ctx: TCtx, opts: ComposeOptions<TCtx> = {}): Promise<ComposedPrompt> {
  const separator = opts.separator ?? DEFAULT_SEPARATOR;
  const rendered: Array<{ id: string; text: string; stable: boolean }> = [];
  for (const s of prompt.sections) {
    let out: string | undefined;
    if (s.kind === 'text') out = s.text;
    else if (s.kind === 'context') out = s.render(ctx);
    else out = await opts.contributors?.[s.slot]?.(ctx);
    if (out === undefined || out.trim() === '') continue;
    rendered.push({ id: s.id, text: out, stable: s.stable });
  }
  const firstVolatile = rendered.findIndex((b) => !b.stable);
  const cacheBoundary = firstVolatile === -1 ? rendered.length : firstVolatile;
  const blocks = rendered.map((b, i) => ({ id: b.id, text: b.text, cache: cacheBoundary > 0 && i === cacheBoundary - 1 }));
  return { name: prompt.name, version: prompt.version, blocks, cacheBoundary, text: blocks.map((b) => b.text).join(separator) };
}

/** Shape accepted by `@apogee/ai`'s `system` field, without importing it. */
export function toSystemBlocks(composed: ComposedPrompt): Array<{ text: string; cache?: boolean }> {
  return composed.blocks.map((b) => (b.cache ? { text: b.text, cache: true } : { text: b.text }));
}
