import { describe, expect, it } from 'vitest';
import { DocumentsError } from '../errors';
import { defineTaxonomy } from '../taxonomy';

const taxonomy = defineTaxonomy([
  { code: 'agreement', label: 'Rental agreement', hints: ['signed by the customer', 'lists equipment and dates'] },
  { code: 'inspection', label: 'Inspection report' },
  { code: 'invoice', label: 'Invoice', hints: ['totals and due date'] },
]);

describe('defineTaxonomy', () => {
  it('keeps codes in order and exposes lookup', () => {
    expect(taxonomy.codes).toEqual(['agreement', 'inspection', 'invoice']);
    expect(taxonomy.byCode('invoice')?.label).toBe('Invoice');
    expect(taxonomy.byCode('deed')).toBeUndefined();
  });
  it('accepts its codes plus unknown', () => {
    expect(taxonomy.codeSchema.parse('unknown')).toBe('unknown');
    expect(taxonomy.codeSchema.parse('invoice')).toBe('invoice');
    expect(taxonomy.codeSchema.safeParse('deed').success).toBe(false);
  });
  it('describes types for a prompt', () => {
    expect(taxonomy.describe()).toBe('- agreement: Rental agreement — signed by the customer; lists equipment and dates\n- inspection: Inspection report\n- invoice: Invoice — totals and due date');
  });
  it('rejects duplicates, the reserved code, and an empty list', () => {
    expect(() => defineTaxonomy([{ code: 'a', label: 'A' }, { code: 'a', label: 'B' }])).toThrow(DocumentsError);
    expect(() => defineTaxonomy([{ code: 'unknown', label: 'X' }])).toThrow(/reserved/);
    expect(() => defineTaxonomy([])).toThrow(/at least one/);
  });
});
