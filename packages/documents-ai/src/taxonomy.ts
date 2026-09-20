import { z } from 'zod';
import { DocumentsError } from './errors';

/** One document type the host recognizes. Hints go into the classify prompt. */
export interface DocumentType {
  code: string;
  label: string;
  hints?: string[];
  description?: string;
}

export const UNKNOWN_CODE = 'unknown';

export interface Taxonomy<C extends string> {
  types: readonly DocumentType[];
  codes: readonly C[];
  /** The codes plus 'unknown'. */
  codeSchema: z.ZodType<C | 'unknown'>;
  byCode(code: string): DocumentType | undefined;
  /** `- code: label — hint; hint`, one per line, for the classify prompt. */
  describe(): string;
}

export function defineTaxonomy<const T extends readonly DocumentType[]>(types: T): Taxonomy<T[number]['code']> {
  type C = T[number]['code'];
  if (types.length === 0) throw new DocumentsError('A taxonomy needs at least one document type', 'EMPTY');
  const seen = new Set<string>();
  for (const t of types) {
    if (t.code === UNKNOWN_CODE) throw new DocumentsError(`"${UNKNOWN_CODE}" is a reserved code`, 'RESERVED_CODE');
    if (seen.has(t.code)) throw new DocumentsError(`Duplicate document type code "${t.code}"`, 'DUPLICATE_CODE');
    seen.add(t.code);
  }
  const codes = types.map((t) => t.code) as C[];
  const byCode = new Map(types.map((t) => [t.code, t] as const));
  const values: string[] = [...codes, UNKNOWN_CODE];
  return {
    types,
    codes,
    codeSchema: z.enum(values),
    byCode: (code) => byCode.get(code),
    describe: () => types.map((t) => `- ${t.code}: ${t.label}${t.hints && t.hints.length > 0 ? ` — ${t.hints.join('; ')}` : ''}`).join('\n'),
  };
}
