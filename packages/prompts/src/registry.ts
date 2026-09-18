import { z } from 'zod';
import { PromptDefinitionError, type Prompt, type Section } from './prompt';

export class PromptNotFoundError extends Error {
  constructor(name: string, version?: string) {
    super(`Prompt not found: ${name}${version ? `@${version}` : ''}`);
    this.name = 'PromptNotFoundError';
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface PromptRegistry {
  register<TCtx>(prompt: Prompt<TCtx>): void;
  /** Latest version when `version` is omitted. */
  get<TCtx = unknown>(name: string, version?: string): Prompt<TCtx>;
  list(): Array<{ name: string; version: string }>;
}

export function createPromptRegistry(): PromptRegistry {
  const store = new Map<string, Map<string, Prompt<never>>>();
  return {
    register(prompt) {
      const versions = store.get(prompt.name) ?? new Map<string, Prompt<never>>();
      versions.set(prompt.version, prompt);
      store.set(prompt.name, versions);
    },
    get<TCtx>(name: string, version?: string): Prompt<TCtx> {
      const versions = store.get(name);
      if (!versions) throw new PromptNotFoundError(name, version);
      const key = version ?? [...versions.keys()].sort(compareVersions).at(-1);
      const p = key !== undefined ? versions.get(key) : undefined;
      if (!p) throw new PromptNotFoundError(name, version);
      return p as Prompt<TCtx>;
    },
    list() {
      return [...store.entries()].flatMap(([name, versions]) => [...versions.keys()].map((version) => ({ name, version })));
    },
  };
}

/** Replace one section's content with static text (e.g. a tenant override). Returns a new prompt. */
export function overrideSection<TCtx>(prompt: Prompt<TCtx>, id: string, replacement: string): Prompt<TCtx> {
  const idx = prompt.sections.findIndex((s) => s.id === id);
  if (idx === -1) throw new PromptDefinitionError(`no section with id ${id} in ${prompt.name}`);
  const original = prompt.sections[idx]!;
  const section: Section<TCtx> = { id, kind: 'text', text: replacement, stable: original.stable };
  return { ...prompt, sections: prompt.sections.map((s, i) => (i === idx ? section : s)) };
}

/** Stored override document, e.g. from a product database. */
export const PromptOverrideSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sections: z.array(z.object({ id: z.string().min(1), text: z.string() })),
});
export type PromptOverride = z.infer<typeof PromptOverrideSchema>;

export function applyOverrides<TCtx>(prompt: Prompt<TCtx>, override: PromptOverride): Prompt<TCtx> {
  const parsed = PromptOverrideSchema.parse(override);
  if (parsed.name !== prompt.name) throw new PromptDefinitionError(`override for ${parsed.name} applied to ${prompt.name}`);
  return parsed.sections.reduce((p, s) => overrideSection(p, s.id, s.text), prompt);
}
