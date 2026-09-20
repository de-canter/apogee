# @apogee/documents-ai

Classify, extract, confirm. The host declares its document types and, per
type, a Zod schema of the fields it wants; the package routes text, images,
and PDFs to the model, returns every claim as a kernel `Assertion` with a
`Confidence`, lets a person correct a field, records runs and corrections
as the ground-truth store for evals, reconciles fields across documents,
and runs it all as a staged, resumable pipeline. Spec:
`docs/design/ai-abstractions.md` §3.7.

## Surface

| Concept | Import | One-liner |
|---|---|---|
| Taxonomy | `defineTaxonomy([{ code, label, hints }])` | The host's document types; yields the code enum (plus `unknown`) and the prompt listing |
| Input | `DocumentInput`, `toContentBlocks`, `inputFromMime`, `roleFor` | Text, image, or PDF; media block first; `vision` role for media, `default` for text |
| Confidence | `confidence`, `confidenceLevel`, `combineConfidence`, `Confidence { value, level, factors }` | Bands at 0.9 and 0.7 (overridable); combination is weakest-link |
| Classify | `classify(input, engine)` → `Classification` | The type code as a proposed assertion (`classified-as`) with confidence and reasoning |
| Extract | `defineExtraction({ code, schema, instructions })`, `defineExtractions`, `extract(def, input, engine)` → `Extraction` | The typed value plus one proposed assertion per field (`field:<name>`) with its own confidence |
| Corrections | `correctField(extraction, { field, original, corrected, by })` | The AI assertion is superseded by a confirmed human one at confidence 1 |
| Audit | `DocumentAuditSink`, `createInMemoryDocumentAudit`, `runFromExtraction`, `groundTruth` | Runs (model, duration, usage, confidence) and their corrections; stats per type; eval ground truth |
| Reconcile | `reconcile(sources, rules)` → `ReconciliationReport` | The same field across documents, compared by host rules (`text`, `name`, `number`, `date`, custom); conflicts with severity |
| Pipeline | `definePipeline`, `runPipeline`, `resumePipeline`, `PipelineStore` | Named stages over a state object, checkpointed after every transition; failed stages retry on resume |
| Process | `processDocument(input, { engine, extractions, audit })` | classify → extract as one pipeline run |
| Prompts | `documentsPromptRegistry()`, `CLASSIFY_PROMPT`, `EXTRACT_PROMPT` | The two registered prompts |

## Guarantees

- PDFs and images reach the model as document and image blocks, never as decoded text.
- Every model claim is an `Assertion` with `source.kind = 'ai'` and the model's confidence; nothing is confirmed until a person does it.
- A correction never mutates the original extraction; it returns a new one and the superseded and confirmed assertions.
- The pipeline never loses which stage failed: the stage result carries the error, and `resumePipeline` retries it.
- No document type, field name, or comparison rule ships in the package.

## Example

```ts
const taxonomy = defineTaxonomy([
  { code: 'agreement', label: 'Rental agreement', hints: ['lists equipment and dates'] },
  { code: 'invoice', label: 'Invoice', hints: ['totals and due date'] },
]);
const extractions = defineExtractions([
  defineExtraction({ code: 'invoice', schema: z.object({ invoiceNumber: z.string(), total: z.number() }), instructions: 'Totals include tax.' }),
]);
const audit = createInMemoryDocumentAudit();
const engine = { taxonomy, client, domain: 'an equipment rental company' };

const run = await processDocument(inputFromMime(file.type, base64, file.name), { engine, extractions, audit });
const extraction = run.state.extraction!;              // fields with confidence, all proposed

const fixed = correctField(extraction, { field: 'total', original: 2250, corrected: 2300, by: ref('User', userId) });
await audit.recordCorrection(runId, fixed.correction);  // ground truth for later evals
```
