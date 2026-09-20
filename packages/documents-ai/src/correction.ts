import type { ModelId, Usage } from '@de_canter/apogee-ai';
import { assertion, AssertionSchema, confirmAssertion, nowIso, sameRef, supersedeAssertion, type Assertion, type ISODate, type Ref } from '@de_canter/apogee-kernel';
import type { Classification } from './classify';
import { combineConfidence, confidence, type Confidence } from './confidence';
import { DocumentsError } from './errors';
import type { Extraction, FieldAssertion } from './extract';

/** A person overruling one extracted field. */
export interface Correction {
  field: string;
  original: unknown;
  corrected: unknown;
  by: Ref;
  at: ISODate;
  reason?: string;
}

export type CorrectionInput = Omit<Correction, 'at'> & { at?: ISODate };

const refLabel = (r: Ref): string => `${r.kind}:${r.id}`;

/**
 * The human's value wins: the field's AI assertion is superseded by a new, confirmed human
 * assertion at confidence 1, and the extraction's combined confidence is recomputed. Returns
 * a new extraction; the input is untouched.
 */
export function correctField<C extends string, T extends Record<string, unknown>>(
  extraction: Extraction<C, T>,
  input: CorrectionInput,
): { extraction: Extraction<C, T>; correction: Correction; superseded: Assertion; confirmed: Assertion } {
  const index = extraction.fields.findIndex((f) => f.field === input.field);
  if (index === -1) throw new DocumentsError(`No extracted field "${input.field}"`, 'UNKNOWN_FIELD');
  const at = input.at ?? nowIso();
  const previous = extraction.fields[index]!;
  const proposed = assertion({
    id: crypto.randomUUID(),
    subject: extraction.subject,
    predicate: `field:${input.field}`,
    object: input.corrected,
    provenance: { source: { kind: 'human', ref: input.by }, method: 'correction', confidence: 1, recordedAt: at },
  });
  const confirmed = confirmAssertion(proposed, input.by, at);
  // A confirmed field can be corrected again, so bypass the proposed-only guard in that case.
  const superseded =
    previous.assertion.status === 'proposed'
      ? supersedeAssertion(previous.assertion, confirmed.id)
      : AssertionSchema.parse({ ...previous.assertion, status: 'superseded', supersededBy: confirmed.id });
  const field: FieldAssertion = { field: input.field, value: input.corrected, confidence: confidence(1, [`corrected by ${refLabel(input.by)}`]), assertion: confirmed };
  const fields = extraction.fields.map((f, i) => (i === index ? field : f));
  const correction: Correction = { field: input.field, original: input.original, corrected: input.corrected, by: input.by, at, ...(input.reason !== undefined ? { reason: input.reason } : {}) };
  return {
    extraction: {
      ...extraction,
      value: { ...extraction.value, [input.field]: input.corrected },
      fields,
      confidence: combineConfidence([...fields.map((f) => f.confidence), extraction.overall]),
    },
    correction,
    superseded,
    confirmed,
  };
}

/** One classify or extract call, as the audit records it. The ground-truth store for evals. */
export interface ExtractionRun {
  id: string;
  at: ISODate;
  kind: 'classify' | 'extract';
  subject: Ref;
  code: string;
  model: ModelId;
  durationMs: number;
  usage: Usage;
  confidence: Confidence;
  value?: unknown;
  warnings?: string[];
  corrections: Correction[];
  metadata?: Record<string, unknown>;
}

export type ExtractionRunInput = Omit<ExtractionRun, 'id' | 'at' | 'corrections'>;

export interface RunFilter { kind?: 'classify' | 'extract'; code?: string; subject?: Ref; from?: ISODate; to?: ISODate }

export interface CorrectionStats {
  totalRuns: number;
  totalCorrections: number;
  /** Extract runs with at least one correction over all extract runs. */
  correctionRate: number;
  topCorrectedFields: Array<{ field: string; count: number }>;
}

export interface DocumentAuditSink {
  recordRun(input: ExtractionRunInput): Promise<ExtractionRun>;
  recordCorrection(runId: string, correction: Correction): Promise<ExtractionRun | undefined>;
  /** Newest first. */
  query(filter?: RunFilter, opts?: { limit?: number; offset?: number }): Promise<{ entries: ExtractionRun[]; total: number; hasMore: boolean }>;
  stats(code?: string): Promise<CorrectionStats>;
}

export const DEFAULT_AUDIT_PAGE = 50;
export const TOP_FIELDS = 10;

function matches(r: ExtractionRun, f: RunFilter): boolean {
  if (f.kind !== undefined && r.kind !== f.kind) return false;
  if (f.code !== undefined && r.code !== f.code) return false;
  if (f.subject !== undefined && !sameRef(r.subject, f.subject)) return false;
  if (f.from !== undefined && r.at < f.from) return false;
  if (f.to !== undefined && r.at > f.to) return false;
  return true;
}

export function createInMemoryDocumentAudit(opts: { now?: () => ISODate } = {}): DocumentAuditSink {
  const now = opts.now ?? nowIso;
  const runs: ExtractionRun[] = [];
  const seq = new Map<string, number>();
  const clone = (r: ExtractionRun): ExtractionRun => ({ ...r, corrections: [...r.corrections] });
  const select = (filter: RunFilter): ExtractionRun[] => runs.filter((r) => matches(r, filter)).sort((a, b) => b.at.localeCompare(a.at) || seq.get(b.id)! - seq.get(a.id)!);
  return {
    recordRun(input) {
      const run: ExtractionRun = { ...input, id: crypto.randomUUID(), at: now(), corrections: [] };
      runs.push(run);
      seq.set(run.id, runs.length);
      return Promise.resolve(clone(run));
    },
    recordCorrection(runId, correction) {
      const run = runs.find((r) => r.id === runId);
      if (!run) return Promise.resolve(undefined);
      run.corrections.push({ ...correction });
      return Promise.resolve(clone(run));
    },
    query(filter = {}, page = {}) {
      const limit = page.limit ?? DEFAULT_AUDIT_PAGE;
      const offset = page.offset ?? 0;
      const all = select(filter);
      return Promise.resolve({ entries: all.slice(offset, offset + limit).map(clone), total: all.length, hasMore: offset + limit < all.length });
    },
    stats(code) {
      const all = select(code !== undefined ? { code } : {});
      const extracts = all.filter((r) => r.kind === 'extract');
      const corrected = extracts.filter((r) => r.corrections.length > 0).length;
      const counts = new Map<string, number>();
      for (const r of all) for (const c of r.corrections) counts.set(c.field, (counts.get(c.field) ?? 0) + 1);
      const topCorrectedFields = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_FIELDS).map(([field, count]) => ({ field, count }));
      return Promise.resolve({
        totalRuns: all.length,
        totalCorrections: all.reduce((s, r) => s + r.corrections.length, 0),
        correctionRate: extracts.length === 0 ? 0 : corrected / extracts.length,
        topCorrectedFields,
      });
    },
  };
}

export function runFromClassification<C extends string>(c: Classification<C>): ExtractionRunInput {
  return { kind: 'classify', subject: c.subject, code: c.code, model: c.usage.model, durationMs: c.durationMs, usage: c.usage, confidence: c.confidence, value: { code: c.code, reasoning: c.reasoning } };
}

export function runFromExtraction<C extends string>(e: Extraction<C, Record<string, unknown>>): ExtractionRunInput {
  return { kind: 'extract', subject: e.subject, code: e.code, model: e.model, durationMs: e.durationMs, usage: e.usage, confidence: e.confidence, value: e.value, warnings: e.warnings };
}

/** For evals: each corrected extract run with the human's values merged over the model's. */
export function groundTruth(runs: readonly ExtractionRun[]): Array<{ runId: string; code: string; subject: Ref; expected: Record<string, unknown>; correctedFields: string[] }> {
  const out: Array<{ runId: string; code: string; subject: Ref; expected: Record<string, unknown>; correctedFields: string[] }> = [];
  for (const r of runs) {
    if (r.kind !== 'extract' || r.corrections.length === 0) continue;
    const expected: Record<string, unknown> = { ...(r.value as Record<string, unknown>) };
    const correctedFields: string[] = [];
    for (const c of r.corrections) {
      expected[c.field] = c.corrected;
      if (!correctedFields.includes(c.field)) correctedFields.push(c.field);
    }
    out.push({ runId: r.id, code: r.code, subject: r.subject, expected, correctedFields });
  }
  return out;
}
