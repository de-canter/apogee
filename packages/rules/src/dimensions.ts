import { z } from 'zod';
import { RulesError } from './errors';

/** The host's condition vocabulary: one Zod type per dimension a rule can condition on. */
export type DimensionShape = Record<string, z.ZodType>;

/** Per dimension, the allowed values; a rule with no conditions always applies. */
export type Conditions<S extends DimensionShape> = { [K in keyof S]?: z.infer<S[K]>[] } & { naturalLanguage?: string };
/** Per dimension, the current value the rule is evaluated against. */
export type Facts<S extends DimensionShape> = { [K in keyof S]?: z.infer<S[K]> };

export interface Dimensions<S extends DimensionShape> {
  shape: S;
  keys: (keyof S & string)[];
  /** Optional array of allowed values (min 1 when present) per dimension, plus optional naturalLanguage. Unknown keys fail. */
  conditions: z.ZodType<Conditions<S>>;
  /** Optional single value per dimension. Unknown keys fail. */
  facts: z.ZodType<Facts<S>>;
  /** One line per dimension for prompts. */
  describe(): string;
}

export const RESERVED_DIMENSION_KEY = 'naturalLanguage';

function describeOne(key: string, schema: z.ZodType): string {
  const json = z.toJSONSchema(schema) as { enum?: unknown[]; type?: string; description?: string };
  const kind = json.enum ? `one of: ${json.enum.map(String).join(', ')}` : (json.type ?? 'value');
  const desc = json.description ? `: ${json.description}` : '';
  return `- ${key} (${kind})${desc}`;
}

export function defineDimensions<S extends DimensionShape>(shape: S): Dimensions<S> {
  const keys = Object.keys(shape) as (keyof S & string)[];
  if (keys.includes(RESERVED_DIMENSION_KEY)) throw new RulesError(`${RESERVED_DIMENSION_KEY} is a reserved dimension name`, 'RESERVED_KEY');
  const conditionShape: Record<string, z.ZodType> = { [RESERVED_DIMENSION_KEY]: z.string().optional() };
  const factShape: Record<string, z.ZodType> = {};
  for (const [k, schema] of Object.entries(shape)) {
    conditionShape[k] = z.array(schema).min(1).optional();
    factShape[k] = schema.optional();
  }
  const conditions = z.object(conditionShape).strict() as unknown as z.ZodType<Conditions<S>>;
  const facts = z.object(factShape).strict() as unknown as z.ZodType<Facts<S>>;
  return {
    shape,
    keys,
    conditions,
    facts,
    describe: () => Object.entries(shape).map(([k, schema]) => describeOne(k, schema)).join('\n'),
  };
}
