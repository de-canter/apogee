import type { Usage } from '@de_canter/apogee-ai';
import { assertion, nowIso, type Assertion, type Ref } from '@de_canter/apogee-kernel';
import { composePrompt, toSystemBlocks } from '@de_canter/apogee-prompts';
import { confidence, type Confidence } from './confidence';
import { roleFor, toContentBlocks, type DocumentInput } from './input';
import { CLASSIFY_PROMPT, classifyOutputSchema, domainOf, requireClient, type DocumentEngineOptions } from './prompts';
import type { DocumentType } from './taxonomy';

export interface ClassifyOptions {
  expectedCodes?: string[];
  /** Assertion subject; default a fresh `{ kind: 'Document', id }`. */
  subject?: Ref;
  label?: string;
}

export interface Classification<C extends string> {
  code: C | 'unknown';
  type?: DocumentType;
  confidence: Confidence;
  reasoning: string;
  /** predicate 'classified-as', object { code, reasoning }, provenance ai with the model's confidence. */
  assertion: Assertion;
  subject: Ref;
  usage: Usage;
  durationMs: number;
}

export const CLASSIFY_SOURCE = `${CLASSIFY_PROMPT.name}@${CLASSIFY_PROMPT.version}`;

export function newDocumentRef(): Ref {
  return { kind: 'Document', id: crypto.randomUUID() };
}

/** Which taxonomy type a document is, as a proposed assertion with confidence. */
export async function classify<C extends string>(input: DocumentInput, engine: DocumentEngineOptions<C>, opts: ClassifyOptions = {}): Promise<Classification<C>> {
  const client = requireClient(engine, 'classify');
  const clock = engine.clock ?? (() => Date.now());
  const started = clock();
  const subject = opts.subject ?? newDocumentRef();
  const composed = await composePrompt(CLASSIFY_PROMPT, { domain: domainOf(engine), taxonomy: engine.taxonomy.describe() });
  const lines = ['Classify this document.'];
  if (input.filename !== undefined) lines.push(`Filename: ${input.filename}`);
  if (opts.expectedCodes && opts.expectedCodes.length > 0) lines.push(`Expected types: ${opts.expectedCodes.join(', ')}`);
  const { value, usage } = await client.generateObject(
    classifyOutputSchema(engine.taxonomy),
    { model: engine.model ?? roleFor(input), system: toSystemBlocks(composed), messages: [{ role: 'user', content: toContentBlocks(input, lines.join('\n')) }], maxTokens: 512 },
    { ...(opts.label !== undefined ? { label: opts.label } : {}) },
  );
  const conf = confidence(value.confidence, [value.reasoning], engine.bands);
  const recordedAt = (engine.now ?? nowIso)();
  const a = assertion({
    id: crypto.randomUUID(),
    subject,
    predicate: 'classified-as',
    object: { code: value.code, reasoning: value.reasoning },
    provenance: { source: { kind: 'ai', name: CLASSIFY_SOURCE }, method: 'classify', confidence: conf.value, recordedAt },
  });
  const type = engine.taxonomy.byCode(value.code);
  return {
    code: value.code,
    ...(type ? { type } : {}),
    confidence: conf,
    reasoning: value.reasoning,
    assertion: a,
    subject,
    usage,
    durationMs: clock() - started,
  };
}
