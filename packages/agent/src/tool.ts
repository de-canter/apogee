import type { ToolDefinition } from '@de_canter/apogee-ai';
import { z } from 'zod';

/** A UI component descriptor returned by a tool. The host registers a component per `type`. */
export interface ArtifactDescriptor {
  type: string;
  id: string;
  data: unknown;
  props?: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
  artifact?: ArtifactDescriptor;
  artifacts?: ArtifactDescriptor[];
}

export interface ToolContext<TCtx> {
  ctx: TCtx;
  /** The provider's tool_use id: use it to build artifact ids. */
  toolUseId: string;
  sessionId: string;
}

export interface Tool<TCtx, TInput = unknown> {
  name: string;
  description: string;
  input: z.ZodType<TInput>;
  execute: (input: TInput, context: ToolContext<TCtx>) => Promise<ToolResult>;
}

export function defineTool<TCtx, TInput>(tool: Tool<TCtx, TInput>): Tool<TCtx, TInput> {
  return tool;
}

/** Any tool for a context, regardless of its input type. Registries hold these. */
export interface AnyTool<TCtx> {
  name: string;
  description: string;
  input: z.ZodType;
  execute: (input: never, context: ToolContext<TCtx>) => Promise<ToolResult>;
}

export interface ToolRegistry<TCtx> {
  get(name: string): AnyTool<TCtx> | undefined;
  list(): AnyTool<TCtx>[];
  add(tool: AnyTool<TCtx>): void;
  remove(name: string): void;
  /** JSON-schema definitions for the model client; cached per tool. */
  definitions(): ToolDefinition[];
}

export function createToolRegistry<TCtx>(tools: readonly AnyTool<TCtx>[] = []): ToolRegistry<TCtx> {
  const map = new Map<string, AnyTool<TCtx>>();
  const schemas = new WeakMap<AnyTool<TCtx>, ToolDefinition>();
  let cached: ToolDefinition[] | undefined;
  for (const t of tools) map.set(t.name, t);
  const definitionOf = (t: AnyTool<TCtx>): ToolDefinition => {
    let d = schemas.get(t);
    if (!d) {
      d = { name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input) };
      schemas.set(t, d);
    }
    return d;
  };
  return {
    get: (name) => map.get(name),
    list: () => [...map.values()],
    add(tool) { map.set(tool.name, tool); cached = undefined; },
    remove(name) { map.delete(name); cached = undefined; },
    definitions() {
      cached ??= [...map.values()].map(definitionOf);
      return cached;
    },
  };
}

export function toolResultContent(result: ToolResult): string {
  return JSON.stringify(result);
}

export function artifactsOf(result: ToolResult): ArtifactDescriptor[] {
  const out: ArtifactDescriptor[] = [];
  if (result.artifact) out.push(result.artifact);
  if (result.artifacts) out.push(...result.artifacts);
  return out;
}
