import { z } from 'zod';
import { KernelError } from './errors';
import { RefSchema, type Ref } from './ref';
import { ISODateSchema, nowIso, type ISODate } from './time';

export const SourceKindSchema = z.enum(['human', 'ai', 'integration', 'system']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/** Cross-cutting mixin: who said so, how, how sure, and who confirmed. */
export const ProvenanceSchema = z.object({
  source: z.object({ kind: SourceKindSchema, ref: RefSchema.optional(), name: z.string().min(1).optional() }),
  method: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  recordedAt: ISODateSchema,
  confirmedBy: RefSchema.optional(),
  confirmedAt: ISODateSchema.optional(),
  evidence: z.array(RefSchema).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ProvenanceSource = Provenance['source'];

export function provenance(
  source: ProvenanceSource,
  opts: Partial<Omit<Provenance, 'source'>> = {},
): Provenance {
  const { recordedAt, ...rest } = opts;
  return ProvenanceSchema.parse({ source, recordedAt: recordedAt ?? nowIso(), ...rest });
}

export function confirm(p: Provenance, by: Ref, at: ISODate = nowIso()): Provenance {
  return ProvenanceSchema.parse({ ...p, confirmedBy: by, confirmedAt: at });
}
export function isConfirmed(p: Provenance): boolean {
  return p.confirmedBy !== undefined;
}

export interface TrustPolicy { minConfidence?: number }

/** Human and system sources are trusted; ai/integration need confirmation or a met confidence floor. Absent confidence is not 1. */
export function isTrusted(p: Provenance, policy: TrustPolicy = {}): boolean {
  if (p.source.kind === 'human' || p.source.kind === 'system') return true;
  if (isConfirmed(p)) return true;
  if (policy.minConfidence !== undefined && p.confidence !== undefined) return p.confidence >= policy.minConfidence;
  return false;
}

export const AssertionStatusSchema = z.enum(['proposed', 'confirmed', 'rejected', 'superseded']);
export type AssertionStatus = z.infer<typeof AssertionStatusSchema>;

/** A statement from a source that may or may not be true. AI output enters the system as one of these. */
export const AssertionSchema = z.object({
  id: z.string().min(1),
  subject: RefSchema,
  predicate: z.string().min(1),
  object: z.unknown(),
  provenance: ProvenanceSchema,
  status: AssertionStatusSchema,
  supersededBy: z.string().min(1).optional(),
  decidedBy: RefSchema.optional(),
  decidedAt: ISODateSchema.optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export class AssertionStateError extends KernelError {
  constructor(from: AssertionStatus, to: AssertionStatus) {
    super(`Cannot move assertion from ${from} to ${to}`, 'ASSERTION_STATE');
  }
}

export function assertion(input: Omit<Assertion, 'status' | 'supersededBy' | 'decidedBy' | 'decidedAt'>): Assertion {
  return AssertionSchema.parse({ ...input, status: 'proposed' });
}

function requireProposed(a: Assertion, to: AssertionStatus): void {
  if (a.status !== 'proposed') throw new AssertionStateError(a.status, to);
}

export function confirmAssertion(a: Assertion, by: Ref, at: ISODate = nowIso()): Assertion {
  requireProposed(a, 'confirmed');
  return AssertionSchema.parse({ ...a, status: 'confirmed', decidedBy: by, decidedAt: at, provenance: confirm(a.provenance, by, at) });
}
export function rejectAssertion(a: Assertion, by: Ref, at: ISODate = nowIso()): Assertion {
  requireProposed(a, 'rejected');
  return AssertionSchema.parse({ ...a, status: 'rejected', decidedBy: by, decidedAt: at });
}
export function supersedeAssertion(a: Assertion, byAssertionId: string): Assertion {
  requireProposed(a, 'superseded');
  return AssertionSchema.parse({ ...a, status: 'superseded', supersededBy: byAssertionId });
}
