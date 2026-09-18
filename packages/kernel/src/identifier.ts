import { z } from 'zod';
import { KernelError } from './errors';

/** How one identity system names things: normalization and optional validation. */
export interface IdentifierScheme {
  code: string;
  label: string;
  normalize: (raw: string) => string;
  validate?: (normalized: string) => boolean;
}

const schemes = new Map<string, IdentifierScheme>();

export class UnknownSchemeError extends KernelError {
  constructor(code: string) { super(`Unknown identifier scheme: ${code}`, 'UNKNOWN_SCHEME'); }
}
export class InvalidIdentifierError extends KernelError {
  constructor(code: string, value: string) { super(`Invalid ${code}: ${value}`, 'INVALID_IDENTIFIER'); }
}

export function registerScheme(scheme: IdentifierScheme): void {
  schemes.set(scheme.code, scheme);
}
export function getScheme(code: string): IdentifierScheme {
  const s = schemes.get(code);
  if (!s) throw new UnknownSchemeError(code);
  return s;
}
/** Test-only: clears the registry so suites are independent. */
export function resetSchemesForTest(): void {
  schemes.clear();
}

/** One external identity for an object. Objects carry many; none is the PK. */
export const IdentifierSchema = z.object({
  scheme: z.string().min(1),
  value: z.string().min(1),
  issuer: z.string().min(1).optional(),
  primary: z.boolean().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
});
export type Identifier = z.infer<typeof IdentifierSchema>;

export const IdentifiersSchema = z.array(IdentifierSchema).refine(
  (ids) => ids.filter((i) => i.primary).length <= 1,
  { message: 'At most one identifier may be primary' },
);

export function normalizeIdentifier(schemeCode: string, raw: string): string {
  return getScheme(schemeCode).normalize(raw);
}

export function identifier(
  schemeCode: string,
  raw: string,
  opts: Omit<Identifier, 'scheme' | 'value'> = {},
): Identifier {
  const scheme = getScheme(schemeCode);
  const value = scheme.normalize(raw);
  if (value.length === 0 || (scheme.validate && !scheme.validate(value))) {
    throw new InvalidIdentifierError(schemeCode, raw);
  }
  return IdentifierSchema.parse({ scheme: schemeCode, value, ...opts });
}

export function findIdentifier(ids: readonly Identifier[], schemeCode: string): Identifier | undefined {
  return ids.find((i) => i.scheme === schemeCode);
}
export function primaryIdentifier(ids: readonly Identifier[]): Identifier | undefined {
  return ids.find((i) => i.primary === true);
}
