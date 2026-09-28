import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaStandard } from '../json-schema';
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
});
