# Plan B4 — `@apogee/documents-ai` + `@apogee/knowledge` + document and knowledge demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-09-19
**Origin:** `docs/design/ai-abstractions.md` §3.7, §3.8, §5. Survey of the reference product (2026-09-19): `services/document-classification/*` (classification prompt, `EXTRACTION_PROMPTS`, cross-validation, extraction audit), `services/vision-extraction-service.ts` (the one path with a system prompt and per-field confidence), `services/document-intake/upload-pipeline-service.ts` (five straight-line stages), `services/examination-engine/examination-engine-service.ts` (write-through stage checkpoints, `ConfidenceScore { value, level, factors }`, 0.9/0.7 banding, weakest-link aggregation, no resume), `services/knowledge-ingestion-service.ts` and `knowledge-retrieval-service.ts` (h1–h3 split, 500-word paragraph split, sha256 hash, upsert by source+title, `$text` then regex fallback, `## Relevant Documentation` template, unused `embedding` field, no scoping, no delete on reingest).

**Goal:** Ship `@apogee/documents-ai` v0.1.0 (taxonomy, content-block routing, classify and extract as assertions with per-field confidence, corrections and an audit sink, cross-document reconciliation, a staged resumable pipeline, `Confidence`) and `@apogee/knowledge` v0.1.0 (markdown chunking, lexical and vector chunk stores with reingest, retrieval with citations, a prompt contributor), then the apogee.build document demo (drop a rental agreement, inspection report, or invoice; watch classify, extract, correct) and knowledge demo (ask about the demo company's policies, with citations, also wired into the rental desk).

**Architecture:** `documents-ai` is a thin, typed layer over `@apogee/ai`: one `DocumentInput` union routed to content blocks (media block first, text after), `generateObject` against host schemas, and every model claim returned as a kernel `Assertion` (a classification, each extracted field) with a `Confidence`. Corrections supersede field assertions with human ones and are recorded through an audit port that doubles as the ground-truth store. The pipeline runner is generic: named stages over a state object, checkpointed after each stage through a store port so a run can resume. `knowledge` is pure functions plus ports: chunks with stable ids and content hashes, a `ChunkStore` with an in-memory lexical (BM25) implementation, a vector implementation over an `EmbeddingPort`, a hybrid combiner, and a retrieval template that cites sources; `knowledgeContributor` fills a prompt slot from the context's question.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4, tsup; `@apogee/{kernel,ai,prompts}` workspace deps (`knowledge` also none of `agent`; `documents-ai` none of `agent`). `node:crypto` for hashing. Demo: Next.js 16 in apogee-build.

**Spec:** `docs/design/ai-abstractions.md` §2, §3.7, §3.8, §5.

## Global Constraints

- Packages `packages/documents-ai` (`@apogee/documents-ai`) and `packages/knowledge` (`@apogee/knowledge`), same toolchain as `packages/rules` (tsup dual build, vitest v8 coverage, `@types/node`, root ESLint, `exactOptionalPropertyTypes`: spread optional keys conditionally, derive input types from Zod with `z.infer`).
- No network in tests: `createFakeModelClient` scripts; its `generateObject` validates scripted objects against the schemas.
- Domain vocabulary is injected: the taxonomy, the per-type extraction schemas and instructions, the reconciliation field rules, the knowledge scopes and sections, and the demo domain all come from the host. The packages ship no document types, no field names, no help topics.
- AI output enters as an `Assertion`: the classification (`predicate: 'classified-as'`) and every extracted field (`predicate: 'field:<name>'`), all `proposed`, provenance `source.kind = 'ai'` with the model's confidence; a correction confirms a human assertion that supersedes the AI one.
- One model client; model role per call: `'vision'` for image and PDF inputs, `'default'` for text, overridable per engine.
- Prompts registered under `documents.classify@1.0.0`, `documents.extract@1.0.0`, `knowledge.answer@1.0.0`; domain-neutral text; the host passes `domain`.
- Confidence banding lifted from the examination engine: `high ≥ 0.9`, `medium ≥ 0.7`, else `low`; thresholds overridable; levels are the three strings (the `REQUIRES_UNDERWRITER` escalation stays in the product).
- Deviations decided here: PDFs go to the model as `document` blocks, never as UTF-8 text; classification returns `'unknown'` rather than failing; the pipeline writes a `failed` stage result with the error and supports `resume`; reingest deletes orphaned chunks; the lexical store ranks its fallback path too (BM25 over title+content) instead of an unranked regex; chunks carry a host-defined `scope` string and search filters on it; embeddings are host-supplied (Anthropic has no embeddings endpoint).
- Branch `feature/b4-documents-knowledge`, commit per task, PR to `main`; after merge tag `documents-ai-v0.1.0` and `knowledge-v0.1.0`. Demo on apogee-build `feature/documents-knowledge-demo`, vendoring locally packed tarballs (identical to the release assets), PR to `main`.
- Definition of done per task: `pnpm typecheck && pnpm lint && pnpm build && pnpm test` unfiltered at the root; ≥ 90% lines per package.

## File Structure

```
packages/documents-ai/src/
├── index.ts
├── errors.ts         # DocumentsError
├── taxonomy.ts       # defineTaxonomy, DocumentType, Taxonomy (codes enum, describe)
├── input.ts          # DocumentInput union, toContentBlocks, inputKind, roleFor
├── confidence.ts     # Confidence, confidence(), confidenceLevel(), combineConfidence(), DEFAULT_BANDS
├── prompts.ts        # DocumentEngineOptions, CLASSIFY_PROMPT, EXTRACT_PROMPT, registry
├── classify.ts       # classify() -> Classification (assertion)
├── extract.ts        # defineExtraction, ExtractionSet, extract() -> Extraction (field assertions)
├── correction.ts     # Correction, correctField(), DocumentAuditSink port + in-memory, ExtractionRun, groundTruth()
├── reconcile.ts      # FieldRule, fuzzyMatch, withinTolerance, reconcile() -> ReconciliationReport
├── pipeline.ts       # definePipeline, runPipeline, resumePipeline, PipelineStore + in-memory, PipelineRun
├── process.ts        # processDocument(): classify -> extract as a pipeline with audit
└── __tests__/ taxonomy, input, confidence, classify, extract, correction, reconcile, pipeline, process, acceptance

packages/knowledge/src/
├── index.ts
├── chunk.ts          # Chunk, chunkMarkdown, chunkId, contentHash, deriveSection, tokenize
├── store.ts          # ChunkStore port, ScoredChunk, createLexicalChunkStore (BM25), reingest()
├── embedding.ts      # EmbeddingPort, createVectorChunkStore, createHybridChunkStore (RRF), cosine
├── retrieve.ts       # retrieve(), formatRetrieval(), knowledgeContributor(), isHelpQuery(), ANSWER_PROMPT, answer()
└── __tests__/ chunk, store, embedding, retrieve, acceptance

apogee-build/ (Tasks 13–14)
├── vendor/apogee-documents-ai-0.1.0.tgz, apogee-knowledge-0.1.0.tgz; package.json
├── src/packages.ts                                  # both -> shipped with demo links
├── src/demo/rental/documents/{taxonomy.ts,samples.ts,script.ts,server.ts}
├── src/demo/rental/knowledge/{policies/*.md,index.ts,script.ts}
├── src/demo/rental/server.ts, prompt.ts             # desk gets a knowledge slot; route sets lastQuestion
├── src/app/api/documents/route.ts, api/documents/correct/route.ts, api/knowledge/route.ts
├── src/app/demo/documents/page.tsx, demo/knowledge/page.tsx
├── src/components/DocumentsDemo.tsx, KnowledgeDemo.tsx
└── src/__tests__/documents.test.ts, knowledge.test.ts
```

---

### Task 1: `@apogee/documents-ai` scaffold, taxonomy, input routing, confidence

**Files:** Create `packages/documents-ai/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts}` (copy from `packages/rules`; deps `@apogee/ai`, `@apogee/kernel`, `@apogee/prompts`, `zod`), `src/errors.ts`, `src/taxonomy.ts`, `src/input.ts`, `src/confidence.ts`, `src/index.ts`. Tests: `taxonomy.test.ts`, `input.test.ts`, `confidence.test.ts`.

**Interfaces:**
```ts
// errors.ts
export class DocumentsError extends Error { constructor(message: string, readonly code: string) }

// taxonomy.ts
export interface DocumentType { code: string; label: string; hints?: string[]; description?: string }
export const UNKNOWN_CODE = 'unknown';
export interface Taxonomy<C extends string> {
  types: readonly DocumentType[];
  codes: readonly C[];
  /** z.enum of the codes plus 'unknown'. */
  codeSchema: z.ZodType<C | 'unknown'>;
  byCode(code: string): DocumentType | undefined;
  /** `- code: label — hint; hint` one per line, for the classify prompt. */
  describe(): string;
}
export function defineTaxonomy<const T extends readonly DocumentType[]>(types: T): Taxonomy<T[number]['code']>;
// throws DocumentsError('DUPLICATE_CODE' | 'RESERVED_CODE' for 'unknown' | 'EMPTY')

// input.ts
export type DocumentInput =
  | { kind: 'text'; text: string; filename?: string }
  | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string; filename?: string }
  | { kind: 'pdf'; data: string; filename?: string };
export const DEFAULT_MAX_TEXT_CHARS = 100_000;
/** Media block first, then the text block, as the provider prefers. Text inputs become a text/plain document block (truncated to maxTextChars, with a note). */
export function toContentBlocks(input: DocumentInput, prompt: string, opts?: { maxTextChars?: number }): ContentBlock[];
/** 'vision' for image and pdf, 'default' for text. */
export function roleFor(input: DocumentInput): ModelRole;
/** Detect from a MIME type: image/* (the four) -> image, application/pdf -> pdf, text/* -> text; else DocumentsError('UNSUPPORTED_TYPE'). */
export function inputFromMime(mediaType: string, data: string, filename?: string): DocumentInput;  // data is base64 for image/pdf, utf-8 text for text/*

// confidence.ts
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export interface ConfidenceBands { high: number; medium: number }
export const DEFAULT_BANDS: ConfidenceBands = { high: 0.9, medium: 0.7 };
export interface Confidence { value: number; level: ConfidenceLevel; factors: string[] }
export function confidenceLevel(value: number, bands?: ConfidenceBands): ConfidenceLevel;
/** Clamps to [0,1]. */
export function confidence(value: number, factors?: string[], bands?: ConfidenceBands): Confidence;
/** Weakest link: min of values; factors concatenated; empty -> 0.5 with factor 'no signals'. */
export function combineConfidence(parts: readonly Confidence[], bands?: ConfidenceBands): Confidence;
```

- [ ] **Step 1: Failing tests.** taxonomy: three types → `codes` order, `codeSchema.parse('unknown')` ok, `parse('deed')` fails, `describe()` equals `- agreement: Rental agreement — signed by the customer; lists equipment and dates\n- inspection: Inspection report\n- invoice: Invoice — totals and due date`; duplicate code throws `DUPLICATE_CODE`; `'unknown'` throws `RESERVED_CODE`; empty throws. input: text → `[{ type: 'document', source: { type: 'text', mediaType: 'text/plain', data }, title: filename }, { type: 'text', text: prompt }]`; long text truncated to `maxTextChars` with `\n\n[truncated]` appended and the prompt untouched; image → image base64 block first; pdf → document pdf block; `roleFor`; `inputFromMime('image/png', …)` and `('application/pdf', …)` and `('text/markdown', …)`; `('application/zip')` throws `UNSUPPORTED_TYPE`. confidence: `0.95 → high`, `0.9 → high`, `0.7 → medium`, `0.69 → low`; custom bands; `confidence(1.4)` clamps to 1; `combineConfidence([0.95, 0.72])` → `0.72 medium` with both factor lists; empty → `0.5` low with `'no signals'`.
- [ ] **Step 2: Implement.** `pnpm install`. **Step 3: Verify, commit** `feat(documents-ai): scaffold with taxonomy, content-block routing, and confidence`.

---

### Task 2: Classification

**Files:** `src/prompts.ts`, `src/classify.ts`; tests `classify.test.ts`.

**Interfaces:**
```ts
// prompts.ts
export interface DocumentEngineOptions<C extends string> {
  client?: ModelClient;
  taxonomy: Taxonomy<C>;
  /** Phrase for prompts, e.g. 'an equipment rental company'. Default 'this application'. */
  domain?: string;
  /** Overrides roleFor(input). */
  model?: ModelRole;
  bands?: ConfidenceBands;
  now?: () => ISODate;
}
export function requireClient<C extends string>(engine: DocumentEngineOptions<C>, what: string): ModelClient;  // DocumentsError NO_CLIENT
export interface ClassifyPromptCtx { domain: string; taxonomy: string }
export const CLASSIFY_PROMPT = definePrompt<ClassifyPromptCtx>({ name: 'documents.classify', version: '1.0.0', sections: [
  fromContext('role', (c) => `You classify documents for ${c.domain}. Choose the single best type code from the list; use "unknown" when none fits or the content is unreadable. Confidence is your certainty in the choice: above 0.9 when the type is unmistakable, 0.7 to 0.9 when it is likely, below 0.7 when you are guessing. Give a one-sentence reasoning.`, { stable: true }),
  fromContext('taxonomy', (c) => `Document types:\n${c.taxonomy}`, { stable: true }),
] });
export const ClassifyOutputSchema = (codes) => z.object({ code: codeSchema, confidence: z.number().min(0).max(1), reasoning: z.string() });
export function documentsPromptRegistry(): PromptRegistry;

// classify.ts
export interface ClassifyOptions { expectedCodes?: string[]; /** Assertion subject; default { kind: 'Document', id: <random uuid> }. */ subject?: Ref; label?: string }
export interface Classification<C extends string> {
  code: C | 'unknown';
  type?: DocumentType;
  confidence: Confidence;
  reasoning: string;
  /** predicate 'classified-as', object { code, reasoning }, provenance ai with confidence. */
  assertion: Assertion;
  subject: Ref;
  usage: Usage;
  durationMs: number;
}
export async function classify<C extends string>(input: DocumentInput, engine: DocumentEngineOptions<C>, opts?: ClassifyOptions): Promise<Classification<C>>;
```
User text: `Classify this document.` + (filename ? `\nFilename: ${filename}` : '') + (expectedCodes ? `\nExpected types: ${…join(', ')}` : ''); content blocks via `toContentBlocks(input, userText)`; `generateObject(ClassifyOutputSchema, { model: engine.model ?? roleFor(input), system, messages: [{ role: 'user', content: blocks }], maxTokens: 512 })`. Provenance `{ source: { kind: 'ai', name: 'documents.classify@1.0.0' }, method: 'classify', confidence, recordedAt }`. `durationMs` from `engine.clock` (add `clock?: () => number` to engine options).

- [ ] **Step 1: Failing tests.** Fake `{ object: { code: 'invoice', confidence: 0.93, reasoning: 'Has totals and a due date.' }, usage: { input: 20 } }` on a text input → `code 'invoice'`, `type.label`, `confidence.level 'high'`, assertion proposed with predicate and provenance confidence, `subject.kind 'Document'`, `usage.input 20`; the fake's call: `model 'default'`, system contains the domain and the taxonomy lines, user content is an array whose first block is the document block and whose last is the text block containing `Filename:` and `Expected types:`; an image input sends `model 'vision'`; `{ code: 'unknown' }` → `type` undefined; `{ code: 'deed' }` → `StructuredOutputError`; no client → `NO_CLIENT`.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(documents-ai): classify documents into a taxonomy as an assertion with confidence`.

---

### Task 3: Extraction with per-field assertions

**Files:** `src/prompts.ts` (+ `EXTRACT_PROMPT`), `src/extract.ts`; test `extract.test.ts`.

**Interfaces:**
```ts
// prompts.ts
export interface ExtractPromptCtx { domain: string; typeLabel: string; instructions: string; fields: string }
export const EXTRACT_PROMPT = definePrompt<ExtractPromptCtx>({ name: 'documents.extract', version: '1.0.0', sections: [
  fromContext('role', (c) => `You extract structured data from documents for ${c.domain}. This document is: ${c.typeLabel}.`, { stable: true }),
  text('guidelines', `Guidelines:
1. Extract only what is visible; omit a field rather than guessing.
2. Give each field a confidence from 0.0 to 1.0 for how clearly you could read it: 0.9 to 1.0 clearly visible, 0.7 to 0.89 readable but worth verifying, below 0.7 uncertain.
3. Dates in ISO format (YYYY-MM-DD); amounts as numbers without symbols; names as written.
4. List anything unusual (missing pages, handwriting, conflicting values) as a warning.`),
  fromContext('fields', (c) => `Fields:\n${c.fields}`, { stable: true }),
  fromContext('instructions', (c) => c.instructions.trim() === '' ? undefined : `Instructions:\n${c.instructions}`, { stable: true }),
] });

// extract.ts
export interface ExtractionDefinition<C extends string, T extends Record<string, unknown>> {
  code: C;
  schema: z.ZodType<T>;               // a z.object; every top-level key is a field
  instructions?: string;
  /** Per-field guidance shown in the prompt; defaults to the schema's .describe() text or the key. */
  fields?: Partial<Record<keyof T & string, string>>;
}
export function defineExtraction<C extends string, T extends Record<string, unknown>>(def: ExtractionDefinition<C, T>): ExtractionDefinition<C, T>;
export interface ExtractionSet<C extends string> { get(code: string): ExtractionDefinition<C, Record<string, unknown>> | undefined; codes(): C[] }
export function defineExtractions<C extends string>(defs: readonly ExtractionDefinition<C, Record<string, unknown>>[]): ExtractionSet<C>;  // duplicate -> DocumentsError
/** Output shape the model fills: the host's object plus per-field confidence, an overall confidence, and warnings. */
export function extractOutputSchema<T>(schema: z.ZodType<T>): z.ZodType<{ data: T; fieldConfidence: Record<string, number>; overallConfidence: number; warnings: string[] }>;
export interface FieldAssertion { field: string; value: unknown; confidence: Confidence; assertion: Assertion }
export interface Extraction<C extends string, T> {
  code: C;
  subject: Ref;
  value: T;
  fields: FieldAssertion[];           // one per key present in value (undefined keys skipped)
  confidence: Confidence;             // combineConfidence(fields) with the model's overallConfidence as one more part
  warnings: string[];
  usage: Usage;
  model: ModelId;
  durationMs: number;
}
export interface ExtractOptions { subject?: Ref; label?: string; /** Extra context appended to the user text (e.g. the order the document belongs to). */ context?: string }
export async function extract<C extends string, T extends Record<string, unknown>>(def: ExtractionDefinition<C, T>, input: DocumentInput, engine: DocumentEngineOptions<C>, opts?: ExtractOptions): Promise<Extraction<C, T>>;
```
Field lines: `- key: description` where description = `def.fields[key] ?? schema description ?? ''`. Field assertions: `predicate: 'field:<key>'`, `object: value`, provenance ai `documents.extract@1.0.0` with `fieldConfidence[key] ?? overallConfidence`. `fieldConfidence` keys not in the schema are ignored.

- [ ] **Step 1: Failing tests.** `defineExtraction({ code: 'invoice', schema: z.object({ invoiceNumber: z.string().describe('The invoice number'), total: z.number(), dueDate: z.string().optional() }), instructions: 'Totals include tax.' })`; fake `{ object: { data: { invoiceNumber: 'INV-7', total: 2250 }, fieldConfidence: { invoiceNumber: 0.98, total: 0.8, bogus: 1 }, overallConfidence: 0.9, warnings: ['Handwritten total'] } }` → `value` typed, `fields` has two entries with levels high and medium and assertions `field:invoiceNumber` / `field:total`, `confidence.value 0.8` (min), `warnings`, `model` from usage, the fake's system contains `Fields:\n- invoiceNumber: The invoice number\n- total\n- dueDate` and `Instructions:`, the user text contains `context` when given; `data` violating the schema → `StructuredOutputError`; `defineExtractions` duplicate throws; `ExtractionSet.get`.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(documents-ai): extract by host schema with per-field assertions and confidence`.

---

### Task 4: Corrections and the audit sink

**Files:** `src/correction.ts`; test `correction.test.ts`.

**Interfaces:**
```ts
export interface Correction { field: string; original: unknown; corrected: unknown; by: Ref; at: ISODate; reason?: string }
/** The human's value wins: the AI field assertion is superseded by a new confirmed human assertion (confidence 1, provenance source human). Returns the updated extraction (new object). Unknown field -> DocumentsError('UNKNOWN_FIELD'). */
export function correctField<C extends string, T extends Record<string, unknown>>(extraction: Extraction<C, T>, correction: Omit<Correction, 'at'> & { at?: ISODate }): { extraction: Extraction<C, T>; correction: Correction; superseded: Assertion; confirmed: Assertion };

export interface ExtractionRun {
  id: string; at: ISODate; kind: 'classify' | 'extract'; subject: Ref; code: string;
  model: ModelId; durationMs: number; usage: Usage; confidence: Confidence;
  value?: unknown; warnings?: string[]; corrections: Correction[]; metadata?: Record<string, unknown>;
}
export type ExtractionRunInput = Omit<ExtractionRun, 'id' | 'at' | 'corrections'>;
export interface RunFilter { kind?; code?; subject?: Ref; from?: ISODate; to?: ISODate }
export interface CorrectionStats { totalRuns: number; totalCorrections: number; correctionRate: number; topCorrectedFields: Array<{ field: string; count: number }> }
export interface DocumentAuditSink {
  recordRun(input: ExtractionRunInput): Promise<ExtractionRun>;
  recordCorrection(runId: string, correction: Correction): Promise<ExtractionRun | undefined>;
  query(filter?: RunFilter, opts?: { limit?: number; offset?: number }): Promise<{ entries: ExtractionRun[]; total: number; hasMore: boolean }>;   // newest first
  stats(code?: string): Promise<CorrectionStats>;   // correctionRate = runs with ≥1 correction / extract runs; top 10 fields
}
export function createInMemoryDocumentAudit(opts?: { now?: () => ISODate }): DocumentAuditSink;
export function runFromClassification(c: Classification<string>): ExtractionRunInput;
export function runFromExtraction(e: Extraction<string, Record<string, unknown>>): ExtractionRunInput;
/** Ground truth for evals: for each extract run with corrections, the corrected value merged over the model's value. */
export function groundTruth(runs: readonly ExtractionRun[]): Array<{ runId: string; code: string; subject: Ref; expected: Record<string, unknown>; correctedFields: string[] }>;
```

- [ ] **Step 1: Failing tests.** `correctField` on the Task 3 extraction: `value.total` becomes 2300, the field's assertion is confirmed with provenance `source.kind 'human'` and `confidence 1`, the returned `superseded` has status `superseded` and `supersededBy` = confirmed id, the original extraction object is untouched, `confidence` recomputed; unknown field throws. Audit: `recordRun` from `runFromExtraction`, `recordCorrection` appends, `query` filters and pages newest first (same-instant tie-break by insertion), `stats('invoice')` → `{ totalRuns: 3, totalCorrections: 2, correctionRate: 0.5 (1 of 2 extract runs corrected), topCorrectedFields: [{ field: 'total', count: 2 }] }`; `groundTruth` merges.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(documents-ai): corrections supersede field assertions; audit sink records runs and corrections`.

---

### Task 5: Reconciliation

**Files:** `src/reconcile.ts`; test `reconcile.test.ts`.

**Interfaces:**
```ts
export type Comparator = 'exact' | 'text' | 'name' | 'number' | 'date' | ((a: unknown, b: unknown) => boolean);
export interface FieldRule { field: string; compare?: Comparator /* 'text' */; tolerance?: number /* relative, for 'number'; default 0.01 */; severity?: 'error' | 'warning' /* 'warning' */; /** Prefer the value from this document code when conflicting. */ preferCode?: string }
export function fuzzyMatch(a: string, b: string): boolean;        // lifted: lowercase/trim/collapse; exact, substring either way, strip trailing suffixes jr|sr|ii|iii|iv and llc|inc|corp|ltd
export function withinTolerance(a: number, b: number, tolerance: number): boolean;   // |a-b|/|b| <= t; b===0 -> a===0
export function sameDay(a: string, b: string): boolean;
export interface ReconcileSource { code: string; subject: Ref; fields: readonly FieldAssertion[] }
export interface FieldReconciliation { field: string; values: Array<{ code: string; subject: Ref; value: unknown; confidence: number }>; agreed: boolean; chosen?: { code: string; subject: Ref; value: unknown; reason: 'only' | 'agreed' | 'preferred' | 'highest-confidence' }; severity?: 'error' | 'warning' }
export interface ReconciliationReport { fields: FieldReconciliation[]; conflicts: FieldReconciliation[]; valid: boolean /* no error-severity conflicts */; documents: number }
export function reconcile(sources: readonly ReconcileSource[], rules?: readonly FieldRule[]): ReconciliationReport;
```
Fields with a value in one source only: `agreed: true`, chosen `only`. Two or more: pairwise compare with the rule's comparator (default `'text'` = trimmed case-insensitive equality; `'name'` = `fuzzyMatch`; `'number'` = `withinTolerance`; `'date'` = `sameDay`; `'exact'` = `Object.is` on JSON); all agree → chosen `agreed` (highest confidence value); else conflict with `severity` from the rule, chosen by `preferCode` if present in values, else `highest-confidence`.

- [ ] **Step 1: Failing tests.** Two sources (agreement, invoice) sharing `customerName` ('Northside Builders' vs 'NORTHSIDE BUILDERS LLC' → name comparator agrees), `total` (2250 vs 2260 → within 1% agrees; vs 2400 with `{ compare: 'number', severity: 'error' }` → error conflict, `valid false`), `startDate` ('2026-09-21' vs '2026-09-21T00:00:00Z' → date agrees), `serial` only in one → `only`; `preferCode: 'agreement'` picks the agreement's value; custom comparator function.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(documents-ai): reconcile fields across documents with host comparators and a conflict report`.

---

### Task 6: Pipeline runner and `processDocument`

**Files:** `src/pipeline.ts`, `src/process.ts`; tests `pipeline.test.ts`, `process.test.ts`.

**Interfaces:**
```ts
// pipeline.ts
export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export interface StageResult { stage: string; status: StageStatus; startedAt?: ISODate; completedAt?: ISODate; durationMs?: number; error?: string; note?: string }
export interface Stage<TState, TCtx> { name: string; /** Returns a patch merged into the state; may return undefined. */ run: (state: TState, ctx: TCtx) => Promise<Partial<TState> | undefined>; /** Skip when false. */ when?: (state: TState) => boolean }
export interface Pipeline<TState, TCtx> { name: string; stages: readonly Stage<TState, TCtx>[] }
export function definePipeline<TState, TCtx = unknown>(p: Pipeline<TState, TCtx>): Pipeline<TState, TCtx>;   // duplicate stage names -> DocumentsError
export type RunStatus = 'running' | 'completed' | 'failed';
export interface PipelineRun<TState> { id: string; pipeline: string; status: RunStatus; currentStage?: string; stages: StageResult[]; state: TState; startedAt: ISODate; completedAt?: ISODate; error?: string }
export interface PipelineStore<TState> { get(id: string): Promise<PipelineRun<TState> | undefined>; save(run: PipelineRun<TState>): Promise<void> }
export function createInMemoryPipelineStore<TState>(): PipelineStore<TState>;
export interface RunOptions<TState, TCtx> { ctx: TCtx; store?: PipelineStore<TState>; runId?: string; skip?: string[]; now?: () => ISODate; clock?: () => number; onStage?: (result: StageResult, run: PipelineRun<TState>) => void }
/** Stages in order; the run is saved after every stage transition (write-through). A throwing stage records status 'failed' with the message, marks the run failed, and rethrows nothing: the run is returned. */
export async function runPipeline<TState, TCtx>(pipeline: Pipeline<TState, TCtx>, initial: TState, opts: RunOptions<TState, TCtx>): Promise<PipelineRun<TState>>;
/** Loads the run and continues from the first stage that is not completed or skipped (a failed stage is retried). Completed run -> returned as is. Unknown id -> DocumentsError('RUN_NOT_FOUND'). */
export async function resumePipeline<TState, TCtx>(pipeline: Pipeline<TState, TCtx>, runId: string, opts: Omit<RunOptions<TState, TCtx>, 'runId'> & { store: PipelineStore<TState> }): Promise<PipelineRun<TState>>;
export function progressOf(run: PipelineRun<unknown>): { completed: number; total: number; percent: number };

// process.ts
export interface ProcessState<C extends string> { input: DocumentInput; subject: Ref; classification?: Classification<C>; extraction?: Extraction<C, Record<string, unknown>>; expectedCode?: C }
export interface ProcessContext<C extends string> { engine: DocumentEngineOptions<C>; extractions: ExtractionSet<C>; audit?: DocumentAuditSink; classify?: ClassifyOptions; extract?: ExtractOptions }
export const DOCUMENT_PIPELINE: Pipeline<ProcessState<string>, ProcessContext<string>>;   // stages 'classify' (skipped when expectedCode set: classification synthesized with confidence 1, factor 'user-specified'), 'extract' (skipped when code is unknown or has no extraction definition; note says why)
export async function processDocument<C extends string>(input: DocumentInput, ctx: ProcessContext<C>, opts?: { subject?: Ref; expectedCode?: C; store?: PipelineStore<ProcessState<C>>; runId?: string }): Promise<PipelineRun<ProcessState<C>>>;
```
`processDocument` records a run in `ctx.audit` after each completed stage (`runFromClassification`, `runFromExtraction`).

- [ ] **Step 1: Failing tests.** pipeline: three stages over `{ n: number; log: string[] }` → run completed, `stages` timestamps and durations from an injected clock, state patched, store saved after each stage (spy count), `progressOf`; `when` false → `skipped`; a throwing second stage → stage `failed` with `error 'boom'`, run `failed`, third stage `pending`; `resumePipeline` on that run with a fixed stage function → retries stage 2, runs 3, `completed`; resuming a completed run returns it unchanged; unknown id throws; `skip: ['b']`. process: fake with two turns (classification `invoice`, extraction) → run completed with both stages, `state.extraction.value`, audit has two runs; `expectedCode: 'invoice'` → classify stage skipped with the synthesized classification (`confidence 1`, factor `user-specified`) and only one model call; classification `unknown` → extract skipped with a note, one model call.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(documents-ai): staged resumable pipeline runner with write-through checkpoints; processDocument`.

---

### Task 7: documents-ai README, index, acceptance

**Files:** `src/index.ts` (export all), `README.md`, `__tests__/acceptance.test.ts`.

- [ ] **Step 1: Acceptance test (§7 criterion).** A taxonomy of three rental document types and two extraction definitions; `processDocument` on a text invoice through the fake (classify → extract); a correction on `total` through `correctField` recorded with `audit.recordCorrection`; `audit.stats('invoice').topCorrectedFields[0].field === 'total'`; `groundTruth` exposes the corrected value; `reconcile` between the invoice extraction and a second (agreement) extraction reports the total conflict; a second `processDocument` with a `store` that fails on the extract stage (fake error turn) leaves a failed run that `resumePipeline` completes on the next fake turn.
- [ ] **Step 2: README** (surface table: taxonomy, input, confidence, classify, extract, corrections/audit, reconcile, pipeline, process; guarantees; example). **Step 3: Verify (≥ 90%), commit** `feat(documents-ai): README and acceptance test`.

---

### Task 8: `@apogee/knowledge` scaffold and chunking

**Files:** Create `packages/knowledge/*` (deps `@apogee/ai`, `@apogee/kernel`, `@apogee/prompts`, `zod`), `src/errors.ts` (`KnowledgeError`), `src/chunk.ts`, `src/index.ts`; test `chunk.test.ts`.

**Interfaces:**
```ts
export interface Chunk {
  /** Stable: `${source}#${slug(title)}` plus `#${part}` for split parts. */
  id: string;
  source: string;            // host path or URL
  section: string;           // first path segment of source, or 'general'
  title: string;             // nearest h1–h3, else basename of source
  content: string;
  hash: string;              // sha256 hex, first 16 chars, of content
  scope: string;             // host-defined visibility, e.g. 'user' | 'admin' | 'platform'
  metadata: { headingLevel: number; wordCount: number; part?: number; [k: string]: unknown };
}
export interface ChunkOptions { section?: string; scope?: string /* 'user' */; maxWords?: number /* 500 */; headingDepth?: 1 | 2 | 3 /* 3 */; metadata?: Record<string, unknown> }
export function chunkMarkdown(source: string, markdown: string, opts?: ChunkOptions): Chunk[];
export function contentHash(text: string): string;
export function deriveSection(source: string): string;
export function chunkId(source: string, title: string, part?: number): string;
export function slug(text: string): string;
/** Lowercase, split on non-alphanumerics, drop tokens shorter than 3 chars and stopwords. */
export function tokenize(text: string): string[];
export const STOPWORDS: ReadonlySet<string>;
```
Algorithm as surveyed: headings h1..headingDepth start a new chunk; text before the first heading is a chunk titled by the source basename (without extension); chunks over `maxWords` split on blank lines greedily, parts titled `${title} (Part n)` with `metadata.part`; empty chunks dropped; fenced code blocks are not split inside.

- [ ] **Step 1: Failing tests.** A markdown with a preamble, `# Rental policies`, `## Deposits`, `### Refunds`, `#### Not a boundary`, a 1,200-word section that splits into three parts at paragraph boundaries, and a fenced block containing `# not a heading` → chunk titles, ids (`policies/rental.md#deposits`, `…#refunds`, `…#long-section#2`), sections (`policies`), `hash` length 16 and stable across calls, `wordCount`, `headingLevel`, `scope` default and override; `tokenize('The Deposit is refundable, within 7 days!')` → `['deposit', 'refundable', 'within', 'days']`.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(knowledge): scaffold with markdown chunking, stable ids, and content hashes`.

---

### Task 9: Chunk store with lexical search and reingest

**Files:** `src/store.ts`; test `store.test.ts`.

**Interfaces:**
```ts
export interface SearchOptions { limit?: number /* 5 */; scope?: string | string[]; section?: string; source?: string }
export interface ScoredChunk extends Chunk { score: number }
export interface UpsertStats { created: number; updated: number; unchanged: number }
export interface ChunkStore {
  upsert(chunks: readonly Chunk[]): Promise<UpsertStats>;         // by id; hash equal -> unchanged
  remove(ids: readonly string[]): Promise<number>;
  list(filter?: { source?: string; scope?: string }): Promise<Chunk[]>;
  search(query: string, opts?: SearchOptions): Promise<ScoredChunk[]>;
  stats(): Promise<{ chunks: number; sources: string[]; sections: Record<string, number>; scopes: Record<string, number> }>;
}
export function createLexicalChunkStore(opts?: { titleWeight?: number /* 2 */; k1?: number /* 1.2 */; b?: number /* 0.75 */ }): ChunkStore;
/** Upsert the new chunks for a source and remove the ones that vanished. */
export async function reingest(store: ChunkStore, source: string, chunks: readonly Chunk[]): Promise<UpsertStats & { removed: number }>;
```
Search: BM25 over `tokenize(title)` (weighted) + `tokenize(content)`; a query with no surviving tokens returns `[]`; results with score 0 excluded; ties broken by id; scope filter accepts one or many; `section` and `source` exact.

- [ ] **Step 1: Failing tests.** Seed six chunks (two scopes, two sections); `search('deposit refund')` ranks the refunds chunk first and excludes unrelated ones; a term in the title outranks the same term in a body; `limit`; `scope: 'admin'` hides user chunks and `scope: ['user','admin']` shows both; `section`; empty/stopword-only query → `[]`; `upsert` again with one changed hash → `{ created: 0, updated: 1, unchanged: 5 }`; `reingest` with a chunk removed → `removed: 1` and `list({ source })` no longer has it; `stats`.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(knowledge): in-memory lexical chunk store (BM25) with scopes and reingest`.

---

### Task 10: Embedding port, vector store, hybrid

**Files:** `src/embedding.ts`; test `embedding.test.ts`.

**Interfaces:**
```ts
export interface EmbeddingPort { embed(texts: readonly string[]): Promise<number[][]>; dimensions?: number }
export function cosine(a: readonly number[], b: readonly number[]): number;
/** Chunks are embedded on upsert (title + content); search embeds the query and ranks by cosine. Same ChunkStore contract, same filters. */
export function createVectorChunkStore(opts: { embedder: EmbeddingPort; minScore?: number /* 0 */ }): ChunkStore;
/** Reciprocal rank fusion of two stores' results (score = Σ 1/(k + rank)); writes go to both. */
export function createHybridChunkStore(opts: { lexical: ChunkStore; vector: ChunkStore; k?: number /* 60 */ }): ChunkStore;
/** Test double: deterministic bag-of-words vectors over a fixed vocabulary, so tests need no model. */
export function createHashEmbedder(dimensions?: number /* 64 */): EmbeddingPort;
```

- [ ] **Step 1: Failing tests.** `cosine` of identical, orthogonal, and zero vectors; vector store with the hash embedder ranks the chunk sharing the query's words first, honors `scope`/`limit`, and `upsert` records embed calls once per changed chunk (spy on the embedder); hybrid returns the union ranked by fused score with a chunk found by both stores first; writes reach both stores.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(knowledge): embedding port, vector chunk store, and hybrid fusion`.

---

### Task 11: Retrieval, template, contributor, answer; README; acceptance

**Files:** `src/retrieve.ts`, `src/index.ts`, `README.md`; tests `retrieve.test.ts`, `acceptance.test.ts`.

**Interfaces:**
```ts
export interface RetrieveOptions extends SearchOptions { heading?: string /* '## Relevant documentation' */; intro?: string /* 'The following excerpts may help answer the question. Cite the source of anything you use.' */; maxChars?: number /* 6000: chunks appended until the budget is hit */ }
export interface Retrieval { chunks: ScoredChunk[]; text: string; citations: Array<{ n: number; id: string; source: string; title: string }> }
/** `### {title} [n]` / `_Source: {source}_` / content, separated by `\n\n---\n\n`; empty when nothing matches. */
export function formatRetrieval(chunks: readonly ScoredChunk[], opts?: RetrieveOptions): Retrieval;
export async function retrieve(store: ChunkStore, query: string, opts?: RetrieveOptions): Promise<Retrieval>;
export const HELP_PATTERNS: readonly RegExp[];   // lifted 13 patterns
export function isHelpQuery(text: string): boolean;
export interface KnowledgeContributorOptions<TCtx> extends RetrieveOptions { store: ChunkStore; queryFromCtx: (ctx: TCtx) => string | undefined; scopeFromCtx?: (ctx: TCtx) => string | string[] | undefined; /** Only retrieve when the query looks like a question; default isHelpQuery. Pass () => true to always retrieve. */ when?: (query: string) => boolean }
export function knowledgeContributor<TCtx>(opts: KnowledgeContributorOptions<TCtx>): Contributor<TCtx>;
export interface AnswerPromptCtx { domain: string }
export const ANSWER_PROMPT = definePrompt<AnswerPromptCtx>({ name: 'knowledge.answer', version: '1.0.0', sections: [ fromContext('role', (c) => `You answer questions about ${c.domain} using only the documentation excerpts provided. Cite each excerpt you use by its number in square brackets, like [1]. If the excerpts do not answer the question, say so and do not invent an answer.`, { stable: true }) ] });
export interface Answer { text: string; retrieval: Retrieval; usage: Usage }
export async function answer(store: ChunkStore, question: string, opts: RetrieveOptions & { client: ModelClient; domain?: string; model?: ModelRole; label?: string }): Promise<Answer>;   // user message: `${retrieval.text}\n\nQuestion: ${question}`; no chunks -> still asks, with 'No documentation matched.' in place of the excerpts
export function knowledgePromptRegistry(): PromptRegistry;
```

- [ ] **Step 1: Failing tests.** `formatRetrieval` exact text for two chunks with `[1]`/`[2]` and citations; `maxChars` cuts after the first chunk; `retrieve` end to end on the lexical store; `isHelpQuery` true for `how do I return a unit?` and false for `book it`; contributor returns undefined for a non-question or no matches, the formatted text otherwise, and passes `scopeFromCtx`; `answer` with a fake `{ text: 'Deposits are refundable within 7 days [1].' }` → the fake's system contains the domain and the user content contains the excerpts and `Question:`. Acceptance: chunk two policy files, `reingest` both, hybrid store (lexical + hash-embedder vector), a `definePrompt` with a `knowledge` slot composed with the contributor and `{ question: 'How do refunds work?' }` contains the refund chunk and `[1]`; `answer` returns citations.
- [ ] **Step 2: Implement; README** (surface: chunk, stores, embedding, retrieve, contributor, answer; guarantees; example). **Step 3: Verify (≥ 90%), commit** `feat(knowledge): retrieval with citations, prompt contributor, answer, README, and acceptance test`.

---

### Task 12: Full verification, docs, PR

- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test`; coverage ≥ 90% both packages. Add both packages to `docs/consuming.md` and the root `README.md` table; update `docs/TODO.md` (B4 → PR open; Jeff merges and tags `documents-ai-v0.1.0`, `knowledge-v0.1.0`). Commit `docs: add documents-ai and knowledge to the README and consuming guide`. Push, open the PR (plan Goal + task list as body). After Jeff merges: tag both, confirm both releases carry tarballs.

---

### Task 13: apogee-build document demo (branch `feature/documents-knowledge-demo`)

**Files:** `vendor/apogee-documents-ai-0.1.0.tgz`, `vendor/apogee-knowledge-0.1.0.tgz` (packed locally from the PR commit), `package.json` (+ deps and overrides), `src/packages.ts`, `src/demo/rental/documents/taxonomy.ts` (taxonomy: `agreement`, `inspection`, `invoice`; three `defineExtraction`s with Zod schemas: agreement `{ agreementNumber, customerName, equipment, serial, startDate, endDate, total }`, inspection `{ serial, inspectedOn, condition: enum(good|worn|damaged), findings: string[], technician }`, invoice `{ invoiceNumber, customerName, total, dueDate, lineItems: [{ description, amount }] }`), `samples.ts` (three text samples as chips, one per type, plus one deliberately ambiguous), `script.ts` (demo-mode fake: routes on the user text: `Classify` → code by keyword (`RENTAL AGREEMENT` → agreement, `INSPECTION` → inspection, `INVOICE` → invoice, else `unknown` at 0.4); `Fields:` → an extraction object built by regexes over the sample text with field confidences), `server.ts` (`documentEngine()`, `documentAudit` per visitor via `rulesFor`-style registry `documentsFor(visitorId)` = `{ audit, store }`), `src/app/api/documents/route.ts` (`POST { text? | file: { mediaType, data(base64), filename } , expectedCode? }` → `processDocument` → JSON `{ runId, classification: { code, label, confidence, reasoning }, extraction?: { code, value, fields: [{ field, value, confidence: { value, level } }], warnings }, stages }`; rate limited; visitor cookie), `src/app/api/documents/correct/route.ts` (`POST { runId, field, corrected }` → `audit.recordCorrection` with `by: ref('User', visitorId)`; returns stats), `src/components/DocumentsDemo.tsx` (client: sample chips, textarea, file input (PNG/JPEG/PDF read as base64), Run button, result card with the classification badge and a field table with per-row confidence chip and an inline "correct" input that posts; stats line "N runs, M corrections, top corrected: …"), `src/app/demo/documents/page.tsx`. Tests `src/__tests__/documents.test.ts`: the route in demo mode on the invoice sample → classification `invoice` and an extraction with `invoiceNumber`; the ambiguous sample → `unknown` and no extraction; a correction → stats reflect it; a bad body → 400.

- [ ] **Step 1:** vendor + install + smoke import. Commit `chore: vendor @apogee/documents-ai and @apogee/knowledge 0.1.0`.
- [ ] **Step 2: Failing tests. Step 3: Implement.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Commit `feat(demo): add the document demo (classify, extract, correct) on the rental domain`.

---

### Task 14: apogee-build knowledge demo and the desk tie-in

**Files:** `src/demo/rental/knowledge/policies/{rental-terms.md,delivery-and-pickup.md,safety.md,deposits-and-damage.md}` (the demo company's policies, consistent with `prompt.ts` hours and delivery fee), `index.ts` (reads the four files at module load with `node:fs`, `chunkMarkdown` with `scope: 'user'` except a fifth `admin-playbook.md` with `scope: 'admin'`, `reingest` into one lexical store per instance; `knowledgeStore`, `knowledgeEngine`), `script.ts` (demo-mode fake for `answer`: returns a sentence quoting the first excerpt's title with `[1]`), `src/app/api/knowledge/route.ts` (`POST { question }` → `answer(store, question, { client, domain, scope: 'user', limit: 4 })` → JSON `{ answer, citations, chunks: [{ n, title, source, score, excerpt }] }`; rate limited), `src/components/KnowledgeDemo.tsx` (question box, three chips, answer with citations rendered as links to the excerpt cards below, each card with title, source, score), `src/app/demo/knowledge/page.tsx`. Desk tie-in: `prompt.ts` gains `slot('knowledge', 'knowledge')` after `rules`; `server.ts` adds `contributors.knowledge = knowledgeContributor<RentalCtx>({ store: knowledgeStore, queryFromCtx: (c) => c.lastQuestion, scope: 'user', limit: 3 })`; `RentalCtx` gains `lastQuestion?: string`; the agent route's `getSession` wrapper calls `session.setContext({ lastQuestion: message })` before `run` (add an optional `beforeRun?: (session, message) => void` to `createAgentRoute`). `packages.ts`: both packages shipped with demo links. Tests `src/__tests__/knowledge.test.ts`: the store has chunks from all five files with the admin one scoped; the route in demo mode answers a refund question with a citation to `deposits-and-damage.md`; the desk prompt composed with `lastQuestion: 'How do refunds work?'` contains `## Relevant documentation`, and with `lastQuestion: 'book it'` does not.

- [ ] **Step 1: Failing tests. Step 2: Implement.** Verify all four commands. Commit `feat(demo): add the knowledge demo and inject policy excerpts into the rental desk`. Push, open PR to `main` (note both demos and the vendored tarballs).

---

### Task 15: File the plan

- [ ] Move this plan to `docs/plans/completed/` with the outcome note; update `docs/TODO.md` (queue: B5 next) and memory. Docs PR.

---

## Self-review

- **§3.7 coverage:** `defineTaxonomy` (T1), `defineExtraction` (T3), `classify` routing image/PDF/text as blocks returning an assertion with confidence (T1, T2), `extract` with per-field assertions (T3), `Correction` and the `AuditSink` recording run, model, duration, corrections as the ground-truth store (T4), `reconcile` with a conflict report (T5), `Pipeline` runner and `Confidence { value, level, factors }` extracted from the examination engine (T6, T1).
- **§3.8 coverage:** `chunkMarkdown` heading then size split with hash and stable ids (T8), `ChunkStore` with `upsert` and `search(query, { scope })` and an in-memory lexical implementation (T9), `EmbeddingPort` and a vector variant (T10), `retrieveSection` as the contributor with citations (T11), role scoping on chunks (T8, T9).
- **§5 demos:** document demo (T13), knowledge demo plus the desk consuming the knowledge base (T14).
- **§2 rules:** ports with in-memory implementations (audit, pipeline store, chunk stores); injected vocabulary; assertions for AI output; one client; registered prompts.
- **Type consistency:** `Confidence` (T1) is used by classify, extract, corrections, process; `FieldAssertion` (T3) feeds `correctField` (T4) and `reconcile` (T5); `Classification`/`Extraction` (T2/T3) are the `ProcessState` fields (T6) and the audit's run inputs (T4); `Chunk` (T8) is what every store (T9, T10) and `formatRetrieval` (T11) handles; `ChunkStore` (T9) is the contract the vector and hybrid stores (T10) implement and `retrieve`/`answer` (T11) consume.
- **Placeholders:** none; every prompt has its text, every LLM function its output schema and user message, every test its fixture.
