import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createKit } from '../kit';
import { manifestOf, portableJsonSchema } from '../manifest';
import { createAjv } from '../json-schema';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

const kit = createKit<ReturnType<typeof makeCtx>, Principal>({
  resources: [ticket], ctx: makeCtx(structuredClone(seed)),
  principal: (a) => Promise.resolve({ user: a?.token ?? 'ann', admin: false }),
});

/** Keywords that constrain an instance; a schema with none of them accepts any value. */
const CONSTRAINING = new Set(['type', 'enum', 'const', 'properties', 'items', 'anyOf', 'oneOf', 'allOf', 'not', '$ref', 'required', 'additionalProperties', 'format', 'pattern']);

/** The two portability findings MCP Inspector's schema lint raises against zod's default output. */
function findings(node: unknown, path = ''): string[] {
  if (typeof node !== 'object' || node === null) return [];
  if (Array.isArray(node)) return node.flatMap((n, i) => findings(n, `${path}[${i}]`));
  const rec = node as Record<string, unknown>;
  const out: string[] = [];
  if (Array.isArray(rec.type)) out.push(`type-union at ${path}`);
  if (!Object.keys(rec).some((k) => CONSTRAINING.has(k))) out.push(`untyped-schema at ${path}`);
  for (const key of ['properties', '$defs'] as const) {
    const map = rec[key];
    if (typeof map === 'object' && map !== null) for (const [name, sub] of Object.entries(map)) out.push(...findings(sub, `${path}.${key}.${name}`));
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'items', 'additionalProperties', 'propertyNames'] as const) {
    if (key in rec) out.push(...findings(rec[key], `${path}.${key}`));
  }
  return out;
}

describe('portableJsonSchema', () => {
  it('splits a nullable type array into anyOf, keeping the constraints on the typed branch', () => {
    expect(portableJsonSchema({ type: ['string', 'null'], minLength: 1, description: 'A name' }))
      .toEqual({ description: 'A name', anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] });
  });
  it('splits a multi-type array into one bare branch per type and keeps the constraints beside it', () => {
    expect(portableJsonSchema({ type: ['string', 'number'], minLength: 2 }))
      .toEqual({ minLength: 2, anyOf: [{ type: 'string' }, { type: 'number' }] });
  });
  it('spells an open additionalProperties as true', () => {
    expect(portableJsonSchema({ type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} }))
      .toEqual({ type: 'object', propertyNames: { type: 'string' }, additionalProperties: true });
  });
  it('rewrites nested schemas and leaves everything else alone', () => {
    const input = { type: 'object', properties: { a: { type: 'array', items: { type: ['integer', 'null'] } }, b: { type: 'string', enum: ['x'] } }, required: ['a'] };
    expect(portableJsonSchema(input)).toEqual({
      type: 'object',
      properties: { a: { type: 'array', items: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }, b: { type: 'string', enum: ['x'] } },
      required: ['a'],
    });
    expect(input.properties.a.items.type).toEqual(['integer', 'null']);   // input not mutated
  });
  it('accepts and rejects the same values as the schema it rewrote', () => {
    const source = z.toJSONSchema(z.object({ n: z.string().min(2).nullable(), bag: z.record(z.string(), z.unknown()) }), { target: 'draft-2020-12' });
    const ajv = createAjv();
    const before = ajv.compile(source);
    const after = ajv.compile(portableJsonSchema(source));
    for (const v of [{ n: null, bag: {} }, { n: 'ab', bag: { k: [1] } }, { n: 'a', bag: {} }, { n: 3, bag: {} }, { n: 'ab' }, { n: 'ab', bag: 1 }]) {
      expect(after(v)).toBe(before(v));
    }
  });
});

describe('manifestOf — portable schemas', () => {
  it('emits no type arrays and no untyped schemas in any capability', () => {
    const all = manifestOf(kit).capabilities.flatMap((c) => [
      ...findings(c.input_schema, `${c.name}.input`), ...findings(c.output_schema, `${c.name}.output`),
    ]);
    expect(all).toEqual([]);
  });
});
