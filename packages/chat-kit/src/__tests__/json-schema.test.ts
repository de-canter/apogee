import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAjv, jsonSchemaStandard } from '../json-schema';
import { envelopeSchema } from '../contract';

const Input = z.object({ id: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) });

describe('jsonSchemaStandard', () => {
  it('validates against the JSON Schema and returns the raw value', () => {
    const schema = z.toJSONSchema(Input, { target: 'draft-2020-12', io: 'input' });
    const std = jsonSchemaStandard(schema);
    expect(std['~standard'].vendor).toBe('apogee-chat-kit');
    expect(std['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toEqual(schema);
    expect(std['~standard'].validate({ id: 't1' })).toEqual({ value: { id: 't1' } });       // defaulted field may be absent
    const bad = std['~standard'].validate({ id: '', limit: 99 });
    expect('issues' in bad && bad.issues.length).toBeGreaterThanOrEqual(2);
    expect('issues' in bad && bad.issues.map((i) => i.path?.join('.'))).toEqual(expect.arrayContaining(['id', 'limit']));
  });
  it('accepts the envelope schema with its branded ISO date and date-time format', () => {
    const schema = z.toJSONSchema(envelopeSchema(z.object({ title: z.string() })), { target: 'draft-2020-12', io: 'output' });
    const std = jsonSchemaStandard(schema);
    const ok = std['~standard'].validate({ resource: 'ticket', id: 't1', state: 'open', data: { title: 'x' }, allowed_next_actions: [], at: '2026-09-28T00:00:00.000Z' });
    expect('value' in ok).toBe(true);
    const bad = std['~standard'].validate({ resource: 'ticket', id: 't1', state: 'open', data: { title: 'x' }, allowed_next_actions: [], at: 'yesterday' });
    expect('issues' in bad).toBe(true);
  });
  it('reports a missing required top-level property with its path', () => {
    const schema = z.toJSONSchema(Input, { target: 'draft-2020-12', io: 'input' });
    const std = jsonSchemaStandard(schema);
    const bad = std['~standard'].validate({});
    expect('issues' in bad).toBe(true);
    const issue = 'issues' in bad ? bad.issues.find((i) => i.path?.join('.') === 'id') : undefined;
    expect(issue).toBeDefined();
    expect(issue?.path).toEqual(['id']);
  });
  it('reports a missing required nested property with its full path', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'object', required: ['b'], properties: { b: { type: 'string' } } } },
    };
    const std = jsonSchemaStandard(schema);
    const bad = std['~standard'].validate({ a: {} });
    expect('issues' in bad).toBe(true);
    const issue = 'issues' in bad ? bad.issues.find((i) => i.path?.join('.') === 'a.b') : undefined;
    expect(issue).toBeDefined();
    expect(issue?.path).toEqual(['a', 'b']);
  });
  it('uses a supplied Ajv instance and compiles lazily, once, on first validate', () => {
    const ajv = createAjv();
    const compile = vi.spyOn(ajv, 'compile');
    const std = jsonSchemaStandard({ type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, { ajv });
    expect(compile).not.toHaveBeenCalled();
    expect(std['~standard'].validate({ id: 'x' })).toEqual({ value: { id: 'x' } });
    expect('issues' in std['~standard'].validate({})).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
  });
});

describe('zod-only formats', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('are pass-through: no unknown-format warning, and the rest of the schema still validates', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const schema = z.toJSONSchema(z.object({ id: z.cuid(), key: z.ulid(), token: z.jwt(), n: z.number() }), { target: 'draft-2020-12', io: 'input' });
    const std = jsonSchemaStandard(schema);
    const ok = { id: 'cjld2cjxh0000qzrmn831i7rn', key: '01ARZ3NDEKTSV4RRFFQ69G5FAV', token: 'not-checked', n: 1 };
    expect(std['~standard'].validate(ok)).toEqual({ value: ok });
    expect('issues' in std['~standard'].validate({ ...ok, n: 'one' })).toBe(true);
    expect('issues' in std['~standard'].validate({ ...ok, id: 'x' })).toBe(true);   // zod's pattern still applies
    expect(warn).not.toHaveBeenCalled();
  });
  it('keep the real ajv-formats validators for formats both libraries know', () => {
    const std = jsonSchemaStandard({ type: 'string', format: 'ipv4' });
    expect('value' in std['~standard'].validate('10.0.0.1')).toBe(true);
    expect('issues' in std['~standard'].validate('not-an-ip')).toBe(true);
  });
});
