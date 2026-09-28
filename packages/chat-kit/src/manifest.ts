import { z } from 'zod';
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
        input_schema: z.toJSONSchema(c.input, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }),
        output_schema: z.toJSONSchema(c.output, { target: 'draft-2020-12', io: 'output', unrepresentable: 'any' }),
      };
      if (c.ui !== undefined) entry.ui = c.ui;
      return entry;
    }),
  };
}
