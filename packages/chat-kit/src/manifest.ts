import { z } from 'zod';
import type { StandardJsonSchema } from './json-schema';
import type { Kit } from './kit';

export interface CapabilityManifestEntry {
  name: string;
  title: string;
  description: string;
  resource: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  ui?: string | undefined;
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
  })),
}) satisfies z.ZodType<KitManifest>;

/** A remote kit's capability schema (from `jsonSchemaStandard`), which already is JSON Schema. */
function isStandardJsonSchema(s: unknown): s is StandardJsonSchema {
  if (typeof s !== 'object' || s === null || !('~standard' in s)) return false;
  return (s as { '~standard': { vendor?: unknown } })['~standard'].vendor === 'apogee-chat-kit';
}

function toJsonSchema(s: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  if (isStandardJsonSchema(s)) return s.jsonSchema;
  return z.toJSONSchema(s, { target: 'draft-2020-12', io, unrepresentable: 'any' });
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
      };
      if (c.ui !== undefined) entry.ui = c.ui;
      return entry;
    }),
  };
}
