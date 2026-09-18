import { describe, expect, it } from 'vitest';
import { ref } from '../ref';
import { isoDate } from '../time';
import {
  AssertionSchema, AssertionStateError, ProvenanceSchema, assertion, confirm, confirmAssertion,
  isConfirmed, isTrusted, provenance, rejectAssertion, supersedeAssertion,
} from '../provenance';

const t0 = isoDate('2026-01-01');
const examiner = ref('Party', 'examiner-1');

describe('Provenance', () => {
  it('records source and time; confidence is optional and bounded', () => {
    const p = provenance({ kind: 'ai', name: 'exam-engine' }, { confidence: 0.82, method: 'llm-extract', recordedAt: t0 });
    expect(p.recordedAt).toBe(t0);
    expect(ProvenanceSchema.safeParse({ ...p, confidence: 1.5 }).success).toBe(false);
  });
  it('confirm sets confirmedBy/At', () => {
    const p = confirm(provenance({ kind: 'ai' }, { recordedAt: t0 }), examiner, isoDate('2026-01-02'));
    expect(isConfirmed(p)).toBe(true);
    expect(p.confirmedBy).toEqual(examiner);
  });
  it('trust: human and system are trusted; ai only when confirmed or above policy threshold', () => {
    expect(isTrusted(provenance({ kind: 'human', ref: examiner }, { recordedAt: t0 }))).toBe(true);
    const ai = provenance({ kind: 'ai' }, { confidence: 0.9, recordedAt: t0 });
    expect(isTrusted(ai)).toBe(false);
    expect(isTrusted(ai, { minConfidence: 0.85 })).toBe(true);
    expect(isTrusted(confirm(ai, examiner))).toBe(true);
    expect(isTrusted(provenance({ kind: 'ai' }, { recordedAt: t0 }), { minConfidence: 0.5 })).toBe(false); // absent ≠ 1
  });
});

describe('Assertion', () => {
  const a = assertion({
    id: 'as-1', subject: ref('Property', 'p1'), predicate: 'hasLien',
    object: { instrument: '2026-000123', amount: { minor: 1250000, currency: 'USD' } },
    provenance: provenance({ kind: 'ai', name: 'exam-engine' }, { confidence: 0.82, recordedAt: t0 }),
  });
  it('starts proposed and is JSON-safe', () => {
    expect(a.status).toBe('proposed');
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(AssertionSchema.safeParse(a).success).toBe(true);
  });
  it('confirm and reject are terminal and record who decided', () => {
    const c = confirmAssertion(a, examiner, isoDate('2026-01-03'));
    expect(c.status).toBe('confirmed');
    expect(c.decidedBy).toEqual(examiner);
    expect(isTrusted(c.provenance)).toBe(true);
    expect(() => rejectAssertion(c, examiner)).toThrow(AssertionStateError);
    expect(rejectAssertion(a, examiner).status).toBe('rejected');
  });
  it('supersede links to the replacement', () => {
    const s = supersedeAssertion(a, 'as-2');
    expect(s.status).toBe('superseded');
    expect(s.supersededBy).toBe('as-2');
    expect(() => supersedeAssertion(s, 'as-3')).toThrow(AssertionStateError);
  });
});
