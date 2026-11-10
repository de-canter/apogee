import { z } from 'zod';
import type { StandardJsonSchema } from './json-schema';
import type { Kit } from './kit';
import type { CapabilityKind, ToolAnnotations } from './capability';

export interface CapabilityManifestEntry {
  name: string;
  title: string;
  description: string;
  resource: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  ui?: string | undefined;
  /** Optional for manifests written before 0.3.0; a remote kit defaults them. */
  kind?: CapabilityKind | undefined;
  annotations?: ToolAnnotations | undefined;
}

export interface KitManifest { version: 1; capabilities: CapabilityManifestEntry[] }

/** Runtime shape of a `KitManifest`; `createRemoteKit` parses its `manifest` with it. */
export const KitManifestSchema = z.object({
  version: z.literal(1),
  capabilities: z.array(z.object({
    name: z.string(),
    title: z.string(),
    description: z.string(),
    resource: z.string(),
    input_schema: z.record(z.string(), z.unknown()),
    output_schema: z.record(z.string(), z.unknown()),
    ui: z.string().optional(),
    kind: z.enum(['load', 'list', 'create', 'transition', 'query', 'capability']).optional(),
    annotations: z.object({ readOnlyHint: z.boolean(), destructiveHint: z.boolean() }).optional(),
  })),
}) satisfies z.ZodType<KitManifest>;

/** A remote kit's capability schema (from `jsonSchemaStandard`), which already is JSON Schema. */
function isStandardJsonSchema(s: unknown): s is StandardJsonSchema {
  if (typeof s !== 'object' || s === null || !('~standard' in s)) return false;
  return (s as { '~standard': { vendor?: unknown } })['~standard'].vendor === 'apogee-chat-kit';
}

/** Keywords that describe a schema rather than constrain a value; they stay beside a split `type`. */
const ANNOTATIONS = new Set(['$schema', '$id', '$defs', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly']);
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Respells a JSON Schema the way the widest set of tool clients read it, without changing what it
 * accepts: a `type` array (zod's spelling of nullable) becomes `anyOf` with one `type` per branch,
 * and an open `additionalProperties: {}` becomes `true`. Clients that map tool schemas onto a
 * single-`type` dialect drop or reject the array form. Returns a copy.
 */
export function portableJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' && isRecord(value) && Object.keys(value).length === 0) out[key] = true;
    else if (SCHEMA_MAPS.has(key) && isRecord(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isRecord(v) ? portableJsonSchema(v) : v]));
    } else if (Array.isArray(value)) out[key] = value.map((v: unknown) => (isRecord(v) ? portableJsonSchema(v) : v));
    else if (isRecord(value) && key !== 'default' && key !== 'const') out[key] = portableJsonSchema(value);
    else out[key] = value;
  }
  const types = out.type;
  if (!Array.isArray(types) || 'anyOf' in out) return out;
  const { type: _type, ...rest } = out;
  const typed = types.filter((t) => t !== 'null');
  if (typed.length !== 1) return { ...rest, anyOf: types.map((t: unknown) => ({ type: t })) };
  const outer: Record<string, unknown> = {};
  const branch: Record<string, unknown> = { type: typed[0] };
  for (const [key, value] of Object.entries(rest)) (ANNOTATIONS.has(key) ? outer : branch)[key] = value;
  return { ...outer, anyOf: types.map((t: unknown) => (t === 'null' ? { type: 'null' } : branch)) };
}

function toJsonSchema(s: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  if (isStandardJsonSchema(s)) return s.jsonSchema;
  return portableJsonSchema(z.toJSONSchema(s, { target: 'draft-2020-12', io, unrepresentable: 'any' }));
}

/**
 * A capability schema as the MCP SDK should see it: it validates exactly as before, and advertises
 * the portable JSON Schema, so a local kit and a remote kit built from its manifest list identical tools.
 */
export function portableStandardSchema<S extends z.ZodType>(s: S): S {
  if (isStandardJsonSchema(s)) return s;
  const jsonSchema = { input: () => toJsonSchema(s, 'input'), output: () => toJsonSchema(s, 'output') };
  return { '~standard': { ...s['~standard'], jsonSchema } } as unknown as S;
}

/** Serializes a kit's capabilities to JSON Schema so an edge can register them without the zod schemas. */
export function manifestOf(kit: Kit): KitManifest {
  return {
    version: 1,
    capabilities: kit.list().map((c) => {
      const entry: CapabilityManifestEntry = {
        name: c.name,
        title: c.title,
        description: c.description,
        resource: c.resource,
        input_schema: toJsonSchema(c.input, 'input'),
        output_schema: toJsonSchema(c.output, 'output'),
        kind: c.kind,
        annotations: c.annotations,
      };
      if (c.ui !== undefined) entry.ui = c.ui;
      return entry;
    }),
  };
}
