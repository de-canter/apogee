import type { ModelId, Usage } from '@apogee/ai';
import { assertion, nowIso, type Assertion, type Ref } from '@apogee/kernel';
import { composePrompt, toSystemBlocks } from '@apogee/prompts';
import { z } from 'zod';
import { newDocumentRef } from './classify';
import { combineConfidence, confidence, type Confidence } from './confidence';
import { DocumentsError } from './errors';
import { roleFor, toContentBlocks, type DocumentInput } from './input';
import { domainOf, EXTRACT_PROMPT, requireClient, type DocumentEngineOptions } from './prompts';

/** What to pull out of one document type: a Zod object whose top-level keys are the fields. */
export interface ExtractionDefinition<C extends string, T extends Record<string, unknown>> {
  code: C;
  schema: z.ZodObject<z.ZodRawShape, z.core.$strip> & z.ZodType<T>;
  instructions?: string;
  /** Per-field guidance for the prompt; defaults to the field schema's description, else nothing. */
  fields?: Partial<Record<keyof T & string, string>>;
}

export function defineExtraction<C extends string, T extends Record<string, unknown>>(def: ExtractionDefinition<C, T>): ExtractionDefinition<C, T> {
  return def;
}

export type AnyExtraction<C extends string> = ExtractionDefinition<C, Record<string, unknown>>;

export interface ExtractionSet<C extends string> {
  get(code: string): AnyExtraction<C> | undefined;
  codes(): C[];
}

export function defineExtractions<C extends string>(defs: readonly AnyExtraction<C>[]): ExtractionSet<C> {
  const map = new Map<string, AnyExtraction<C>>();
  for (const d of defs) {
    if (map.has(d.code)) throw new DocumentsError(`Duplicate extraction for "${d.code}"`, 'DUPLICATE_CODE');
    map.set(d.code, d);
  }
  return { get: (code) => map.get(code), codes: () => [...map.keys()] as C[] };
}

/** The model fills the host's object plus a confidence per field, an overall confidence, and warnings. */
export function extractOutputSchema<T>(schema: z.ZodType<T>) {
  return z.object({
    data: schema,
    fieldConfidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
    overallConfidence: z.number().min(0).max(1),
    warnings: z.array(z.string()).default([]),
  });
}

export interface FieldAssertion {
  field: string;
  value: unknown;
  confidence: Confidence;
  assertion: Assertion;
}

export interface Extraction<C extends string, T> {
  code: C;
  subject: Ref;
  value: T;
  /** One per field present in `value`. */
  fields: FieldAssertion[];
  /** Weakest link across the fields and the model's overall confidence. */
  confidence: Confidence;
  warnings: string[];
  usage: Usage;
  model: ModelId;
  durationMs: number;
}

export interface ExtractOptions {
  subject?: Ref;
  label?: string;
  /** Extra context appended to the user text, e.g. the record the document belongs to. */
  context?: string;
}

export const EXTRACT_SOURCE = `${EXTRACT_PROMPT.name}@${EXTRACT_PROMPT.version}`;

function fieldLines<C extends string, T extends Record<string, unknown>>(def: ExtractionDefinition<C, T>): string {
  const shape = def.schema.shape;
  return Object.entries(shape)
    .map(([key, field]) => {
      const description = def.fields?.[key as keyof T & string] ?? (field as z.ZodType).description;
      return description ? `- ${key}: ${description}` : `- ${key}`;
    })
    .join('\n');
}

/** Structured data from one document, every field a proposed assertion with its own confidence. */
export async function extract<C extends string, T extends Record<string, unknown>>(
  def: ExtractionDefinition<C, T>,
  input: DocumentInput,
  engine: DocumentEngineOptions<C>,
  opts: ExtractOptions = {},
): Promise<Extraction<C, T>> {
  const client = requireClient(engine, 'extract');
  const clock = engine.clock ?? (() => Date.now());
  const started = clock();
  const subject = opts.subject ?? newDocumentRef();
  const typeLabel = engine.taxonomy.byCode(def.code)?.label ?? def.code;
  const composed = await composePrompt(EXTRACT_PROMPT, { domain: domainOf(engine), typeLabel, instructions: def.instructions ?? '', fields: fieldLines(def) });
  const user = ['Extract the fields from this document.', ...(opts.context !== undefined ? [opts.context] : [])].join('\n');
  const { value, usage } = await client.generateObject(
    extractOutputSchema(def.schema as z.ZodType<T>),
    { model: engine.model ?? roleFor(input), system: toSystemBlocks(composed), messages: [{ role: 'user', content: toContentBlocks(input, user) }], maxTokens: 4096 },
    { ...(opts.label !== undefined ? { label: opts.label } : {}) },
  );
  const recordedAt = (engine.now ?? nowIso)();
  const fields: FieldAssertion[] = [];
  for (const [field, fieldValue] of Object.entries(value.data as Record<string, unknown>)) {
    if (fieldValue === undefined) continue;
    const score = value.fieldConfidence[field] ?? value.overallConfidence;
    const conf = confidence(score, [], engine.bands);
    fields.push({
      field,
      value: fieldValue,
      confidence: conf,
      assertion: assertion({
        id: crypto.randomUUID(),
        subject,
        predicate: `field:${field}`,
        object: fieldValue,
        provenance: { source: { kind: 'ai', name: EXTRACT_SOURCE }, method: 'extract', confidence: conf.value, recordedAt },
      }),
    });
  }
  const overall = confidence(value.overallConfidence, [`overall ${value.overallConfidence}`], engine.bands);
  return {
    code: def.code,
    subject,
    value: value.data,
    fields,
    confidence: combineConfidence([...fields.map((f) => f.confidence), overall], engine.bands),
    warnings: value.warnings,
    usage,
    model: usage.model,
    durationMs: clock() - started,
  };
}
