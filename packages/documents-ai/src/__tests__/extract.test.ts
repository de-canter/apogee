import { createFakeModelClient, StructuredOutputError, type ContentBlock, type SystemBlock } from '@apogee/ai';
import { isoDate } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DocumentsError } from '../errors';
import { defineExtraction, defineExtractions, extract } from '../extract';
import type { DocumentInput } from '../input';
import { defineTaxonomy } from '../taxonomy';

const taxonomy = defineTaxonomy([{ code: 'invoice', label: 'Invoice' }, { code: 'agreement', label: 'Rental agreement' }]);
const now = () => isoDate('2026-09-19T12:00:00Z');
const engine = { taxonomy, domain: 'an equipment rental company', now };
const systemText = (system: string | SystemBlock[] | undefined): string => (typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n'));

export const invoice = defineExtraction({
  code: 'invoice',
  schema: z.object({ invoiceNumber: z.string().describe('The invoice number'), total: z.number(), dueDate: z.string().optional() }),
  instructions: 'Totals include tax.',
  fields: { total: 'Grand total in dollars' },
});
const text: DocumentInput = { kind: 'text', text: 'INVOICE INV-7 total 2250.00' };

const output = { data: { invoiceNumber: 'INV-7', total: 2250 }, fieldConfidence: { invoiceNumber: 0.98, total: 0.8, bogus: 1 }, overallConfidence: 0.9, warnings: ['Handwritten total'] };

describe('extract', () => {
  it('returns the typed value with one assertion per field and a weakest-link confidence', async () => {
    const client = createFakeModelClient([{ object: output, usage: { input: 30, output: 12 } }]);
    const e = await extract(invoice, text, { ...engine, client }, { context: 'Belongs to rental RA-2026001.' });
    expect(e.code).toBe('invoice');
    expect(e.value).toEqual({ invoiceNumber: 'INV-7', total: 2250 });
    expect(e.fields.map((f) => f.field)).toEqual(['invoiceNumber', 'total']);
    expect(e.fields[0]).toMatchObject({ value: 'INV-7', confidence: { value: 0.98, level: 'high' } });
    expect(e.fields[1]).toMatchObject({ value: 2250, confidence: { value: 0.8, level: 'medium' } });
    expect(e.fields[1]!.assertion).toMatchObject({ status: 'proposed', predicate: 'field:total', object: 2250, subject: e.subject });
    expect(e.fields[1]!.assertion.provenance).toEqual({ source: { kind: 'ai', name: 'documents.extract@1.0.0' }, method: 'extract', confidence: 0.8, recordedAt: '2026-09-19T12:00:00.000Z' });
    expect(e.confidence.value).toBe(0.8);
    expect(e.confidence.factors).toContain('overall 0.9');
    expect(e.warnings).toEqual(['Handwritten total']);
    expect(e.usage.input).toBe(30);
    expect(e.model).toBe(e.usage.model);

    const call = client.calls[0]!;
    const system = systemText(call.system);
    expect(system).toContain('This document is: Invoice.');
    expect(system).toContain('Fields:\n- invoiceNumber: The invoice number\n- total: Grand total in dollars\n- dueDate');
    expect(system).toContain('Instructions:\nTotals include tax.');
    const blocks = call.messages[0]!.content as ContentBlock[];
    const last = blocks[blocks.length - 1];
    expect(last?.type === 'text' && last.text).toContain('Belongs to rental RA-2026001.');
  });

  it('falls back to the overall confidence for fields the model did not score', async () => {
    const client = createFakeModelClient([{ object: { ...output, fieldConfidence: {} } }]);
    const e = await extract(invoice, text, { ...engine, client });
    expect(e.fields.map((f) => f.confidence.value)).toEqual([0.9, 0.9]);
  });

  it('rejects data that does not fit the schema and needs a client', async () => {
    await expect(extract(invoice, text, { ...engine, client: createFakeModelClient([{ object: { ...output, data: { invoiceNumber: 7 } } }]) })).rejects.toBeInstanceOf(StructuredOutputError);
    await expect(extract(invoice, text, engine)).rejects.toBeInstanceOf(DocumentsError);
  });
});

describe('defineExtractions', () => {
  it('indexes by code and rejects duplicates', () => {
    const set = defineExtractions([invoice]);
    expect(set.get('invoice')?.code).toBe('invoice');
    expect(set.get('agreement')).toBeUndefined();
    expect(set.codes()).toEqual(['invoice']);
    expect(() => defineExtractions([invoice, invoice])).toThrow(DocumentsError);
  });
});
