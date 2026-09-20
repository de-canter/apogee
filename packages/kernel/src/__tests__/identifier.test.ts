import { beforeEach, describe, expect, it } from 'vitest';
import {
  IdentifiersSchema, InvalidIdentifierError, UnknownSchemeError, findIdentifier, identifier,
  normalizeIdentifier, primaryIdentifier, registerScheme, resetSchemesForTest,
} from '../identifier';
import { isoDate } from '../time';

describe('Identifier', () => {
  beforeEach(() => {
    resetSchemesForTest();
    registerScheme({ code: 'apn', label: 'Assessor Parcel Number', normalize: (r) => r.replace(/[-\s]/g, '').toUpperCase() });
    registerScheme({
      code: 'order-number', label: 'Order Number',
      normalize: (r) => r.trim().toUpperCase(),
      validate: (n) => /^[A-Z]{2,4}-\d{4,}$/.test(n),
    });
  });

  it('normalizes through the scheme', () => {
    expect(normalizeIdentifier('apn', ' 123-45-678 ')).toBe('12345678');
    expect(identifier('apn', '123-45-678')).toEqual({ scheme: 'apn', value: '12345678' });
  });
  it('validates when the scheme defines validate', () => {
    expect(identifier('order-number', 'tp-00042').value).toBe('TP-00042');
    expect(() => identifier('order-number', 'nope')).toThrow(InvalidIdentifierError);
  });
  it('throws on unknown scheme', () => {
    expect(() => identifier('vin', '1HGCM')).toThrow(UnknownSchemeError);
  });
  it('finds by scheme and picks the primary', () => {
    const ids = [identifier('apn', '1'), identifier('order-number', 'TP-1000', { primary: true })];
    expect(findIdentifier(ids, 'order-number')?.value).toBe('TP-1000');
    expect(findIdentifier(ids, 'vin')).toBeUndefined();
    expect(primaryIdentifier(ids)?.scheme).toBe('order-number');
  });
  it('rejects more than one primary', () => {
    const ids = [identifier('apn', '1', { primary: true }), identifier('order-number', 'TP-1000', { primary: true })];
    expect(IdentifiersSchema.safeParse(ids).success).toBe(false);
  });
  it('carries issuer and validity and stays JSON-safe', () => {
    const id = identifier('apn', '1', { issuer: 'County Appraisal District', validFrom: isoDate('2024-01-01') });
    expect(id.issuer).toBe('County Appraisal District');
    expect(JSON.parse(JSON.stringify(id))).toEqual(id);
  });
});
