import { AiError, createFakeModelClient, type SystemBlock } from '@apogee/ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDimensions } from '../dimensions';
import { RulesError } from '../errors';
import { evaluateGate, evaluateRule } from '../evaluate';
import { requireClient } from '../prompts';
import { defineRule } from '../rule';

const dims = defineDimensions({ event: z.enum(['created', 'returned']), tier: z.enum(['standard', 'high']) });
const engine = { dims, domain: 'an equipment rental company' };

const deposit = defineRule(dims, {
  id: 'deposit', name: 'Deposit note', category: 'gate', gate: 'confirm',
  conditions: { event: ['created'], tier: ['high'] },
  instruction: 'Confirm a deposit was collected and recorded in the notes.',
  structuredChecks: [{ field: 'notes', check: 'not_empty', message: 'A deposit note is required' }],
});
const serials = defineRule(dims, {
  id: 'serials', name: 'Serial recorded', category: 'gate',
  conditions: { event: ['created'] },
  structuredChecks: [{ field: 'serial', check: 'exists', message: 'Serial is required' }],
});

const systemText = (system: string | SystemBlock[] | undefined): string => (typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n'));

describe('evaluateRule', () => {
  it('is decided by disabled when the rule is off', async () => {
    const r = await evaluateRule({ ...deposit, enabled: false }, engine, { facts: { event: 'created', tier: 'high' } });
    expect(r).toMatchObject({ matched: false, passed: true, decidedBy: 'disabled', checks: [] });
  });
  it('is decided by conditions when facts do not match', async () => {
    const r = await evaluateRule(deposit, engine, { facts: { event: 'created', tier: 'standard' } });
    expect(r).toMatchObject({ matched: false, passed: true, decidedBy: 'conditions' });
  });
  it('is decided by checks when a structured check fails', async () => {
    const client = createFakeModelClient([]);
    const r = await evaluateRule(deposit, { ...engine, client }, { facts: { event: 'created', tier: 'high' }, subject: { notes: [] } });
    expect(r).toMatchObject({ matched: true, decidedBy: 'checks', passed: false });
    expect(r.errors.map((e) => e.message)).toEqual(['A deposit note is required']);
    expect(client.calls).toHaveLength(0);
  });
});

describe('evaluateGate', () => {
  it('fails on an error-severity check without calling the model', async () => {
    const client = createFakeModelClient([]);
    const g = await evaluateGate([deposit, serials], { ...engine, client }, { facts: { event: 'created', tier: 'high' }, subject: { notes: ['Deposit taken'] } });
    expect(g.passed).toBe(false);
    expect(g.errors.map((e) => e.message)).toEqual(['Serial is required']);
    expect(g.results.find((r) => r.ruleId === 'serials')).toMatchObject({ decidedBy: 'checks', passed: false });
    expect(client.calls).toHaveLength(0);
  });

  it('runs the instruction layer once when checks pass', async () => {
    const client = createFakeModelClient([{ object: { passed: false, findings: ['No deposit amount recorded'] }, usage: { input: 7, output: 3 } }]);
    const g = await evaluateGate([deposit, serials], { ...engine, client }, { facts: { event: 'created', tier: 'high' }, subject: { notes: ['Called customer'], serial: 'EXC-1000' } });
    expect(g.passed).toBe(false);
    expect(g.gate).toBe('confirm');
    expect(g.ai).toMatchObject({ passed: false, findings: ['No deposit amount recorded'] });
    expect(g.ai?.usage.input).toBe(7);
    expect(g.results.find((r) => r.ruleId === 'deposit')).toMatchObject({ decidedBy: 'instruction', passed: false, findings: ['No deposit amount recorded'] });
    expect(g.results.find((r) => r.ruleId === 'serials')).toMatchObject({ decidedBy: 'checks', passed: true });
    expect(client.calls).toHaveLength(1);
    const call = client.calls[0]!;
    expect(systemText(call.system)).toContain('equipment rental company');
    const user = call.messages[0]!.content as string;
    expect(user).toContain('Deposit note');
    expect(user).toContain('"notes"');
    expect(user).not.toContain('Serial recorded');
  });

  it('uses only the structured layer without a client', async () => {
    const g = await evaluateGate([deposit], engine, { facts: { event: 'created', tier: 'high' }, subject: { notes: ['ok'] } });
    expect(g.passed).toBe(true);
    expect(g.ai).toBeUndefined();
    expect(g.results[0]).toMatchObject({ decidedBy: 'checks', passed: true });
  });

  it('propagates model errors', async () => {
    const client = createFakeModelClient([{ error: new AiError('boom', 'X') }]);
    await expect(evaluateGate([deposit], { ...engine, client }, { facts: { event: 'created', tier: 'high' }, subject: { notes: ['ok'] } })).rejects.toThrow('boom');
  });

  it('passes trivially when nothing matches', async () => {
    const g = await evaluateGate([deposit, serials], engine, { facts: { event: 'returned' } });
    expect(g).toMatchObject({ passed: true, matched: 0, errors: [], warnings: [] });
    expect(g.evaluatedAt).toMatch(/^\d{4}-/);
  });

  it('keeps warnings advisory and still runs the instruction layer', async () => {
    const advisory = { ...deposit, structuredChecks: [{ ...deposit.structuredChecks[0]!, severity: 'warning' as const }] };
    const client = createFakeModelClient([{ object: { passed: true, findings: ['Deposit discussed'] } }]);
    const g = await evaluateGate([advisory], { ...engine, client }, { facts: { event: 'created', tier: 'high' }, subject: { notes: [] } });
    expect(g.passed).toBe(true);
    expect(g.warnings.map((w) => w.message)).toEqual(['A deposit note is required']);
    expect(g.results[0]).toMatchObject({ decidedBy: 'instruction', passed: true });
  });

  it('lets describeSubject shape what the model sees', async () => {
    const client = createFakeModelClient([{ object: { passed: true, findings: ['ok'] } }]);
    await evaluateGate([deposit], { ...engine, client }, { facts: { event: 'created', tier: 'high' }, subject: { notes: ['ok'], secret: 'x' }, describeSubject: (s) => ({ notes: (s as { notes: string[] }).notes }) });
    expect(client.calls[0]!.messages[0]!.content as string).not.toContain('secret');
  });
});

describe('requireClient', () => {
  it('throws a RulesError without a client', () => {
    expect(() => requireClient(engine, 'parseRule')).toThrow(RulesError);
    expect(() => requireClient(engine, 'parseRule')).toThrow('parseRule needs a model client');
  });
});
