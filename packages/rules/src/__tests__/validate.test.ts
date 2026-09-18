import { createFakeModelClient } from '@apogee/ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDimensions } from '../dimensions';
import { defineRule, type Rule } from '../rule';
import { crossRuleDiagnostics, structuralDiagnostics, validateRule, validateRules } from '../validate';

const dims = defineDimensions({ event: z.enum(['created', 'returned']), tier: z.enum(['standard', 'high']) });
type D = typeof dims.shape;
const engine = { dims, domain: 'an equipment rental company' };

const codes = (ds: { code: string }[]) => [...new Set(ds.map((d) => d.code))].sort();

describe('structuralDiagnostics', () => {
  it('reports the sloppy-rule set at once', () => {
    const sloppy = defineRule(dims, {
      id: 'sloppy', name: 'Sloppy', category: 'desk', conditions: {}, priority: 600,
      instruction: 'Be nice.',
      suggestedActions: ['ok', 'ok', 'send_sheet'], defaultAction: 'apply_rate',
      structuredChecks: [{ field: 'total', check: 'gt', message: 'Too small' }],
    });
    expect(codes(structuralDiagnostics(sloppy, dims))).toEqual(['S002', 'S003', 'S005', 'S006', 'S008', 'S009', 'S010']);
  });
  it('reports schema violations as S001 with the field', () => {
    const bad = { ...defineRule(dims, { id: 'x', name: 'X', category: 'desk', conditions: {} }), priority: 2000 };
    const ds = structuralDiagnostics(bad, dims);
    expect(ds.filter((d) => d.code === 'S001')).toMatchObject([{ severity: 'error', field: 'priority' }]);
  });
  it('warns about an empty condition array (which the schema also rejects)', () => {
    const r = defineRule(dims, { id: 'x', name: 'X', category: 'desk', conditions: {}, instruction: 'A long enough instruction for the assistant to follow here.', description: 'd' });
    const empty: Rule<D> = { ...r, conditions: { event: [] as never[] } };
    expect(codes(structuralDiagnostics(empty, dims))).toEqual(['S001', 'S004']);
  });
  it('is silent on a clean rule', () => {
    const clean = defineRule(dims, {
      id: 'clean', name: 'Clean', category: 'desk', conditions: { event: ['created'] }, description: 'A clean rule.',
      instruction: 'Remind the customer about the harness requirement before handing over aerial equipment.',
      suggestedActions: ['send_safety_sheet'], defaultAction: 'send_safety_sheet',
    });
    expect(structuralDiagnostics(clean, dims)).toEqual([]);
  });
});

describe('crossRuleDiagnostics', () => {
  const a = defineRule(dims, { id: 'a', name: 'A', category: 'desk', conditions: { event: ['created'] }, priority: 100 });
  const twin = defineRule(dims, { id: 'twin', name: 'Twin', category: 'desk', conditions: { event: ['created'] }, priority: 100 });
  const broad = defineRule(dims, { id: 'broad', name: 'Broad', category: 'desk', conditions: { event: ['created', 'returned'] }, priority: 50 });
  const dupe = { ...broad, id: 'a', name: 'Dupe' };
  const other = defineRule(dims, { id: 'other', name: 'Other', category: 'gate', conditions: { event: ['created'] }, priority: 100 });
  it('finds duplicates, identical conditions, shadowing, and priority ties', () => {
    const ds = crossRuleDiagnostics(a, [twin, broad, dupe, other]);
    expect(codes(ds)).toEqual(['C001', 'C002', 'C003', 'C004']);
    expect(ds.find((d) => d.code === 'C003')?.message).toContain('broad');
  });
  it('ignores disabled rules', () => {
    expect(crossRuleDiagnostics(a, [{ ...twin, enabled: false }])).toEqual([]);
  });
});

describe('validateRule', () => {
  const target = defineRule(dims, { id: 't', name: 'Target', category: 'desk', conditions: { event: ['created'] }, description: 'd', instruction: 'A long enough instruction for the assistant to follow here.' });
  const overlapping = defineRule(dims, { id: 'o', name: 'Overlap', category: 'desk', conditions: { event: ['created', 'returned'] }, description: 'd', instruction: 'A long enough instruction for the assistant to follow here too.' });
  it('summarizes without AI by default', async () => {
    const r = await validateRule(target, engine, { others: [overlapping] });
    expect(r).toMatchObject({ valid: true, aiChecksPerformed: false, summary: { errors: 0, warnings: 0, info: 1 } });
    expect(r.usage).toBeUndefined();
  });
  it('runs AI checks on request with overlapping rules in the message', async () => {
    const client = createFakeModelClient([{ object: { findings: [{ code: 'A001', severity: 'warning', message: 'Vague' }] }, usage: { input: 3 } }]);
    const r = await validateRule(target, { ...engine, client }, { others: [overlapping], ai: true });
    expect(r.aiChecksPerformed).toBe(true);
    expect(r.diagnostics.find((d) => d.code === 'A001')).toMatchObject({ ruleId: 't', severity: 'warning', message: 'Vague' });
    expect(r.usage?.input).toBe(3);
    const user = client.calls[0]!.messages[0]!.content as string;
    expect(user).toContain('Target rule:');
    expect(user).toContain('Overlapping rules in the same category:');
    expect(user).toContain('"o"');
  });
  it('says so when nothing overlaps', async () => {
    const client = createFakeModelClient([{ object: { findings: [] } }]);
    const far = defineRule(dims, { id: 'far', name: 'Far', category: 'desk', conditions: { event: ['returned'] } });
    await validateRule(target, { ...engine, client }, { others: [far], ai: true });
    expect(client.calls[0]!.messages[0]!.content as string).toContain('No overlapping rules.');
  });
  it('needs a client for AI checks', async () => {
    await expect(validateRule(target, engine, { ai: true })).rejects.toMatchObject({ code: 'NO_CLIENT' });
  });
  it('marks invalid when an error diagnostic exists', async () => {
    const r = await validateRule({ ...target, priority: -1 }, engine);
    expect(r.valid).toBe(false);
    expect(r.summary.errors).toBe(1);
  });
});

describe('validateRules', () => {
  it('validates each against the others and reports a duplicate id once', async () => {
    const a = defineRule(dims, { id: 'a', name: 'A', category: 'desk', conditions: {}, description: 'd', instruction: 'A long enough instruction for the assistant to follow here.' });
    const r = await validateRules([a, { ...a, name: 'A again' }], engine);
    expect(r.diagnostics.filter((d) => d.code === 'C001')).toHaveLength(1);
    expect(r.valid).toBe(false);
  });
});
