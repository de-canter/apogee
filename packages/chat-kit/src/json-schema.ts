import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export interface StandardIssue { message: string; path?: (string | number)[] | undefined }
export type StandardResult = { value: unknown } | { issues: StandardIssue[] };

/** The Standard Schema (+ JSON Schema) shape SDK 2 accepts for tool input/output. */
export interface StandardJsonSchema {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: 'apogee-chat-kit';
    readonly validate: (value: unknown) => StandardResult;
    readonly jsonSchema: {
      readonly input: (options: { target: string }) => Record<string, unknown>;
      readonly output: (options: { target: string }) => Record<string, unknown>;
    };
  };
  /** The raw schema, for hosts that want it. */
  readonly jsonSchema: Record<string, unknown>;
}

export interface JsonSchemaStandardOptions {
  /** The Ajv 2020 instance to compile with; defaults to a shared one from `createAjv()`. */
  ajv?: Ajv2020 | undefined;
}

/**
 * Formats `z.toJSONSchema` can emit that ajv-formats does not define. They are accepted as-is
 * (zod also emits a `pattern` for most of them, which Ajv does enforce); registering them keeps
 * Ajv from warning `unknown format "cuid" ignored` for every schema that uses one.
 */
const ZOD_ONLY_FORMATS = [
  'cuid', 'cuid2', 'ulid', 'nanoid', 'jwt', 'e164', 'emoji', 'base64', 'base64url',
  'cidrv4', 'cidrv6', 'ipv4', 'ipv6', 'xid', 'ksuid',
] as const;

/** An Ajv 2020 instance configured the way `jsonSchemaStandard` expects: formats loaded, zod-only formats pass-through. */
export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false });
  addFormats(ajv);
  // Only fill gaps: a format ajv-formats already validates (ipv4, ipv6) keeps its real check.
  for (const name of ZOD_ONLY_FORMATS) if (!(name in ajv.formats)) ajv.addFormat(name, true);
  return ajv;
}

let shared: Ajv2020 | undefined;
function sharedAjv(): Ajv2020 {
  shared ??= createAjv();
  return shared;
}

/**
 * Wraps a JSON Schema (draft 2020-12) as a Standard Schema that validates with Ajv and advertises itself as JSON Schema.
 * The schema is compiled on the first `validate`, not here, so building a kit from a large manifest stays cheap.
 */
export function jsonSchemaStandard(schema: Record<string, unknown>, opts: JsonSchemaStandardOptions = {}): StandardJsonSchema {
  let validator: ValidateFunction | undefined;
  const validate = (value: unknown): StandardResult => {
    validator ??= (opts.ajv ?? sharedAjv()).compile(schema);
    if (validator(value)) return { value };
    const issues: StandardIssue[] = (validator.errors ?? []).map((e) => {
      const base: (string | number)[] = e.instancePath
        ? e.instancePath.split('/').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s))
        : [];
      const path = [...base];
      // A missing required property is reported against the *parent* instancePath, so the
      // property name itself must be appended for the path to point at the actual failure.
      if (e.keyword === 'required') {
        const missing = (e.params as { missingProperty?: string }).missingProperty;
        if (missing !== undefined) path.push(missing);
      }
      return { message: e.message ?? 'invalid', path: path.length > 0 ? path : undefined };
    });
    return { issues };
  };
  return {
    '~standard': {
      version: 1,
      vendor: 'apogee-chat-kit',
      validate,
      jsonSchema: { input: () => schema, output: () => schema },
    },
    jsonSchema: schema,
  };
}
