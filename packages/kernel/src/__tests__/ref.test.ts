import { describe, expect, it } from 'vitest';
import { RefSchema, ref, sameRef } from '../ref';

describe('Ref', () => {
  it('builds a ref with kind and id', () => {
    expect(ref('Order', 'abc')).toEqual({ kind: 'Order', id: 'abc' });
  });

  it('validates shape and rejects empty strings', () => {
    expect(RefSchema.safeParse({ kind: 'Order', id: 'abc' }).success).toBe(true);
    expect(RefSchema.safeParse({ kind: '', id: 'abc' }).success).toBe(false);
    expect(RefSchema.safeParse({ kind: 'Order', id: '' }).success).toBe(false);
  });

  it('compares refs structurally', () => {
    expect(sameRef(ref('Order', '1'), ref('Order', '1'))).toBe(true);
    expect(sameRef(ref('Order', '1'), ref('Party', '1'))).toBe(false);
  });

  it('is JSON-safe', () => {
    const r = ref('Order', '1');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
