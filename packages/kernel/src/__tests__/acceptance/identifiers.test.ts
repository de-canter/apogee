import { beforeAll, describe, expect, it } from 'vitest';
import { IdentifiersSchema, findIdentifier, identifier, primaryIdentifier, registerScheme, resetSchemesForTest } from '../../identifier';

describe('One order, six identity systems', () => {
  beforeAll(() => {
    resetSchemesForTest();
    registerScheme({ code: 'order-number', label: 'GF / Order Number', normalize: (r) => r.trim().toUpperCase() });
    registerScheme({ code: 'loan-number', label: 'Lender Loan Number', normalize: (r) => r.replace(/\s/g, '') });
    registerScheme({ code: 'apn', label: 'Assessor Parcel Number', normalize: (r) => r.replace(/[-\s]/g, '') });
    registerScheme({ code: 'underwriter-file', label: 'Underwriter File Number', normalize: (r) => r.trim() });
    registerScheme({
      code: 'book-page', label: 'Recording Book/Page',
      normalize: (r) => { const [b, p] = r.split('/'); return `${(b ?? '').padStart(5, '0')}/${(p ?? '').padStart(4, '0')}`; },
      validate: (n) => /^\d{5}\/\d{4}$/.test(n),
    });
    registerScheme({ code: 'instrument-number', label: 'Instrument Number', normalize: (r) => r.trim() });
  });

  it('carries all of them, with the order number primary and none of them the PK', () => {
    const ids = [
      identifier('order-number', 'ord-2026-000417', { primary: true }),
      identifier('loan-number', '88 210 4471', { issuer: 'First National' }),
      identifier('apn', 'R-123456-01', { issuer: 'County Appraisal District' }),
      identifier('underwriter-file', 'UW-TX-99120', { issuer: 'Acme Underwriters' }),
      identifier('book-page', '123/45'),
      identifier('instrument-number', '2026-000998877'),
    ];
    expect(IdentifiersSchema.safeParse(ids).success).toBe(true);
    expect(primaryIdentifier(ids)?.value).toBe('ORD-2026-000417');
    expect(findIdentifier(ids, 'book-page')?.value).toBe('00123/0045');
    expect(findIdentifier(ids, 'apn')?.value).toBe('R12345601');
  });
});
