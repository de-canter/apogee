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

let ajv: Ajv2020 | undefined;
function engine(): Ajv2020 {
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false });
    addFormats(ajv);
  }
  return ajv;
}

/** Wraps a JSON Schema (draft 2020-12) as a Standard Schema that validates with Ajv and advertises itself as JSON Schema. */
export function jsonSchemaStandard(schema: Record<string, unknown>): StandardJsonSchema {
  const validator: ValidateFunction = engine().compile(schema);
  const validate = (value: unknown): StandardResult => {
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
