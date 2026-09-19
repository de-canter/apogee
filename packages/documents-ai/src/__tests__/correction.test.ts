import { createFakeModelClient } from '@apogee/ai';
import { isoDate, ref } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classify } from '../classify';
import { correctField, createInMemoryDocumentAudit, groundTruth, runFromClassification, runFromExtraction } from '../correction';
import { DocumentsError } from '../errors';
import { defineExtraction, extract, type Extraction } from '../extract';
import { defineTaxonomy } from '../taxonomy';

const taxonomy = defineTaxonomy([{ code: 'invoice', label: 'Invoice' }]);
const now = () => isoDate('2026-09-19T12:00:00Z');
const invoice = defineExtraction({ code: 'invoice', schema: z.object({ invoiceNumber: z.string(), total: z.number() }) });
const jeff = ref('User', 'jeff');

async function extracted(): Promise<Extraction<'invoice', { invoiceNumber: string; total: number }>> {
  const client = createFakeModelClient([{ object: { data: { invoiceNumber: 'INV-7', total: 2250 }, fieldConfidence: { invoiceNumber: 0.98, total: 0.8 }, overallConfidence: 0.9, warnings: [] } }]);
  return extract(invoice, { kind: 'text', text: 'x' }, { taxonomy, client, now });
}

describe('correctField', () => {
  it('supersedes the AI assertion with a confirmed human one and recomputes confidence', async () => {
    const before = await extracted();
    const at = isoDate('2026-09-19T13:00:00Z');
    const { extraction, correction, superseded, confirmed } = correctField(before, { field: 'total', original: 2250, corrected: 2300, by: jeff, reason: 'Tax line missed', at });
    expect(extraction.value.total).toBe(2300);
    expect(before.value.total).toBe(2250);
    const total = extraction.fields.find((f) => f.field === 'total')!;
    expect(total.value).toBe(2300);
    expect(total.confidence).toEqual({ value: 1, level: 'high', factors: ['corrected by User:jeff'] });
    expect(total.assertion).toBe(confirmed);
    expect(confirmed).toMatchObject({ status: 'confirmed', predicate: 'field:total', object: 2300, decidedBy: jeff, decidedAt: at });
    expect(confirmed.provenance).toMatchObject({ source: { kind: 'human', ref: jeff }, confidence: 1, confirmedBy: jeff });
    expect(superseded).toMatchObject({ status: 'superseded', supersededBy: confirmed.id, object: 2250 });
    expect(correction).toEqual({ field: 'total', original: 2250, corrected: 2300, by: jeff, at, reason: 'Tax line missed' });
    expect(extraction.confidence.value).toBe(0.9);
  });
  it('rejects an unknown field', async () => {
    const e = await extracted();
    expect(() => correctField(e, { field: 'nope', original: 1, corrected: 2, by: jeff })).toThrow(DocumentsError);
  });
});

describe('document audit', () => {
  it('records runs and corrections, queries newest first, and reports stats', async () => {
    let n = 0;
    const audit = createInMemoryDocumentAudit({ now: () => isoDate(`2026-09-19T12:0${n++}:00Z`) });
    const e1 = await extracted();
    const e2 = await extracted();
    const c = await classify({ kind: 'text', text: 'x' }, { taxonomy, now, client: createFakeModelClient([{ object: { code: 'invoice', confidence: 0.9, reasoning: 'r' } }]) });
    const r1 = await audit.recordRun(runFromExtraction(e1));
    const r2 = await audit.recordRun(runFromExtraction(e2));
    const r3 = await audit.recordRun(runFromClassification(c));
    expect(r3).toMatchObject({ kind: 'classify', code: 'invoice', value: { code: 'invoice' }, corrections: [] });
    expect(r1).toMatchObject({ kind: 'extract', model: e1.model, confidence: { value: 0.8 }, value: { total: 2250 } });

    const fix = correctField(e1, { field: 'total', original: 2250, corrected: 2300, by: jeff });
    await audit.recordCorrection(r1.id, fix.correction);
    await audit.recordCorrection(r1.id, correctField(fix.extraction, { field: 'total', original: 2300, corrected: 2310, by: jeff }).correction);
    expect(await audit.recordCorrection('nope', fix.correction)).toBeUndefined();

    const all = await audit.query();
    expect(all.total).toBe(3);
    expect(all.entries.map((r) => r.id)).toEqual([r3.id, r2.id, r1.id]);
    expect((await audit.query({ kind: 'extract' })).total).toBe(2);
    expect((await audit.query({ subject: e2.subject })).entries[0]?.id).toBe(r2.id);
    expect((await audit.query({ from: isoDate('2026-09-19T12:02:00Z') })).total).toBe(1);
    const page = await audit.query({}, { limit: 2 });
    expect(page.hasMore).toBe(true);

    expect(await audit.stats('invoice')).toEqual({ totalRuns: 3, totalCorrections: 2, correctionRate: 0.5, topCorrectedFields: [{ field: 'total', count: 2 }] });
    expect((await audit.stats('other')).totalRuns).toBe(0);

    const truth = groundTruth(all.entries);
    expect(truth).toEqual([{ runId: r1.id, code: 'invoice', subject: e1.subject, expected: { invoiceNumber: 'INV-7', total: 2310 }, correctedFields: ['total'] }]);
  });
});
