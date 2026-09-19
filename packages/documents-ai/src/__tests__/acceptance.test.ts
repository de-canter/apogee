/**
 * Spec §7 criterion: classify and extract a demo document, record a correction, and
 * expose it for eval; reconcile across documents; resume a failed run.
 */
import { AiError, createFakeModelClient, type FakeTurn, type GenerateRequest } from '@apogee/ai';
import { isoDate, ref } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { correctField, createInMemoryDocumentAudit, groundTruth } from '../correction';
import { defineExtraction, defineExtractions } from '../extract';
import { createInMemoryPipelineStore, resumePipeline } from '../pipeline';
import { documentPipeline, processDocument, type ProcessState } from '../process';
import { reconcile } from '../reconcile';
import { defineTaxonomy } from '../taxonomy';

const taxonomy = defineTaxonomy([
  { code: 'agreement', label: 'Rental agreement', hints: ['lists equipment and dates'] },
  { code: 'inspection', label: 'Inspection report' },
  { code: 'invoice', label: 'Invoice', hints: ['totals and due date'] },
]);
type Code = (typeof taxonomy.codes)[number];
const extractions = defineExtractions<Code>([
  defineExtraction({ code: 'invoice', schema: z.object({ invoiceNumber: z.string(), customerName: z.string(), total: z.number() }) }),
  defineExtraction({ code: 'agreement', schema: z.object({ agreementNumber: z.string(), customerName: z.string(), total: z.number() }) }),
]);
const now = () => isoDate('2026-09-19T12:00:00Z');

const invoiceText = { kind: 'text' as const, text: 'INVOICE INV-7\nBill to: Northside Builders\nTotal due: $2,250.00' };
const agreementText = { kind: 'text' as const, text: 'RENTAL AGREEMENT RA-2026001\nCustomer: NORTHSIDE BUILDERS LLC\nTotal: $2,400.00' };

/** One fake serves both documents; it routes on the document text and on whether the call is a classify or an extract. */
let failNextExtract = false;
const script = (req: GenerateRequest): FakeTurn => {
  const content = req.messages[0]!.content;
  const doc = typeof content === 'string' ? '' : content.map((b) => (b.type === 'document' && b.source.type === 'text' ? b.source.data : '')).join('');
  const prompt = typeof content === 'string' ? content : content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const isInvoice = doc.includes('INVOICE');
  if (prompt.startsWith('Classify')) return { object: { code: isInvoice ? 'invoice' : 'agreement', confidence: 0.94, reasoning: 'Header says so.' } };
  if (failNextExtract) {
    failNextExtract = false;
    return { error: new AiError('overloaded', 'OVERLOADED') };
  }
  return isInvoice
    ? { object: { data: { invoiceNumber: 'INV-7', customerName: 'Northside Builders', total: 2250 }, fieldConfidence: { total: 0.75 }, overallConfidence: 0.9, warnings: [] } }
    : { object: { data: { agreementNumber: 'RA-2026001', customerName: 'NORTHSIDE BUILDERS LLC', total: 2400 }, fieldConfidence: {}, overallConfidence: 0.88, warnings: ['Total is handwritten'] } };
};

describe('acceptance: classify, extract, correct, reconcile, resume', () => {
  it('round-trips a document through the pipeline and the correction loop', async () => {
    const client = createFakeModelClient(script);
    const audit = createInMemoryDocumentAudit({ now });
    const ctx = { engine: { taxonomy, client, domain: 'an equipment rental company', now }, extractions, audit };

    // 1. Intake: classify then extract; every claim is a proposed assertion with confidence.
    const run = await processDocument(invoiceText, ctx);
    expect(run.status).toBe('completed');
    const invoice = run.state.extraction!;
    expect(run.state.classification).toMatchObject({ code: 'invoice', confidence: { level: 'high' } });
    expect(invoice.fields.find((f) => f.field === 'total')).toMatchObject({ confidence: { value: 0.75, level: 'medium' }, assertion: { status: 'proposed' } });

    // 2. A person corrects the total; the audit becomes ground truth.
    const runs = await audit.query({ kind: 'extract' });
    const fixed = correctField(invoice, { field: 'total', original: 2250, corrected: 2300, by: ref('User', 'jeff'), reason: 'Missed the tax line' });
    await audit.recordCorrection(runs.entries[0]!.id, fixed.correction);
    expect(fixed.extraction.fields.find((f) => f.field === 'total')!.assertion.status).toBe('confirmed');
    expect((await audit.stats('invoice')).topCorrectedFields[0]).toEqual({ field: 'total', count: 1 });
    const truth = groundTruth((await audit.query()).entries);
    expect(truth[0]?.expected).toEqual({ invoiceNumber: 'INV-7', customerName: 'Northside Builders', total: 2300 });

    // 3. A second document about the same rental; reconciliation reports the disagreement.
    const agreementRun = await processDocument(agreementText, ctx);
    const agreement = agreementRun.state.extraction!;
    const report = reconcile(
      [{ code: 'invoice', subject: invoice.subject, fields: fixed.extraction.fields }, { code: 'agreement', subject: agreement.subject, fields: agreement.fields }],
      [{ field: 'customerName', compare: 'name' }, { field: 'total', compare: 'number', severity: 'error', preferCode: 'agreement' }],
    );
    expect(report.fields.find((f) => f.field === 'customerName')?.agreed).toBe(true);
    expect(report.conflicts.map((c) => c.field)).toEqual(['total']);
    expect(report.valid).toBe(false);
    expect(report.conflicts[0]?.chosen).toMatchObject({ code: 'agreement', value: 2400, reason: 'preferred' });

    // 4. A run that fails mid-way resumes from the failed stage.
    const store = createInMemoryPipelineStore<ProcessState<Code>>();
    failNextExtract = true;
    const failed = await processDocument(invoiceText, ctx, { store, runId: 'doc-2' });
    expect(failed.status).toBe('failed');
    expect(failed.stages.map((s) => s.status)).toEqual(['completed', 'failed']);
    const resumed = await resumePipeline(documentPipeline<Code>(), 'doc-2', { ctx, store, now });
    expect(resumed.status).toBe('completed');
    expect(resumed.state.extraction?.value).toMatchObject({ invoiceNumber: 'INV-7' });
    expect(client.calls).toHaveLength(7);
  });
});
