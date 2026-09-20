import { createFakeModelClient } from '@de_canter/apogee-ai';
import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInMemoryDocumentAudit } from '../correction';
import { defineExtraction, defineExtractions } from '../extract';
import { createInMemoryPipelineStore } from '../pipeline';
import { processDocument, type ProcessState } from '../process';
import { defineTaxonomy } from '../taxonomy';

const taxonomy = defineTaxonomy([{ code: 'invoice', label: 'Invoice' }, { code: 'agreement', label: 'Rental agreement' }]);
const extractions = defineExtractions([defineExtraction({ code: 'invoice', schema: z.object({ invoiceNumber: z.string(), total: z.number() }) })]);
const now = () => isoDate('2026-09-19T12:00:00Z');
const input = { kind: 'text' as const, text: 'INVOICE INV-7 total 2250' };
const classification = { object: { code: 'invoice', confidence: 0.93, reasoning: 'r' } };
const extraction = { object: { data: { invoiceNumber: 'INV-7', total: 2250 }, fieldConfidence: { total: 0.8 }, overallConfidence: 0.9, warnings: [] } };

describe('processDocument', () => {
  it('classifies then extracts, recording both runs', async () => {
    const client = createFakeModelClient([classification, extraction]);
    const audit = createInMemoryDocumentAudit({ now });
    const run = await processDocument(input, { engine: { taxonomy, client, now }, extractions, audit });
    expect(run.status).toBe('completed');
    expect(run.stages.map((s) => `${s.stage}:${s.status}`)).toEqual(['classify:completed', 'extract:completed']);
    expect(run.state.classification?.code).toBe('invoice');
    expect(run.state.extraction?.value).toEqual({ invoiceNumber: 'INV-7', total: 2250 });
    expect(run.state.extraction?.subject).toEqual(run.state.subject);
    expect((await audit.query()).entries.map((r) => r.kind)).toEqual(['extract', 'classify']);
    expect(client.calls).toHaveLength(2);
  });

  it('skips classification when the caller names the type', async () => {
    const client = createFakeModelClient([extraction]);
    const run = await processDocument(input, { engine: { taxonomy, client, now }, extractions }, { expectedCode: 'invoice' });
    expect(run.stages[0]).toMatchObject({ stage: 'classify', status: 'skipped', note: 'user-specified' });
    expect(run.state.classification).toMatchObject({ code: 'invoice', confidence: { value: 1, factors: ['user-specified'] } });
    expect(run.state.extraction?.code).toBe('invoice');
    expect(client.calls).toHaveLength(1);
  });

  it('skips extraction for unknown types and types without a definition', async () => {
    const unknown = await processDocument(input, { engine: { taxonomy, client: createFakeModelClient([{ object: { code: 'unknown', confidence: 0.3, reasoning: 'r' } }]), now }, extractions });
    expect(unknown.stages[1]).toMatchObject({ stage: 'extract', status: 'skipped', note: 'unknown type' });
    expect(unknown.state.extraction).toBeUndefined();
    const undefinedType = await processDocument(input, { engine: { taxonomy, client: createFakeModelClient([{ object: { code: 'agreement', confidence: 0.9, reasoning: 'r' } }]), now }, extractions });
    expect(undefinedType.stages[1]).toMatchObject({ status: 'skipped', note: 'no extraction defined for agreement' });
  });

  it('persists to a store so a failed run can resume', async () => {
    const store = createInMemoryPipelineStore<ProcessState<'invoice' | 'agreement'>>();
    const client = createFakeModelClient([classification, { error: new Error('overloaded') as never }, extraction]);
    const failed = await processDocument(input, { engine: { taxonomy, client, now }, extractions }, { store, runId: 'doc-1' });
    expect(failed.status).toBe('failed');
    expect(failed.stages[1]).toMatchObject({ stage: 'extract', status: 'failed', error: 'overloaded' });
    expect((await store.get('doc-1'))?.status).toBe('failed');
  });
});
