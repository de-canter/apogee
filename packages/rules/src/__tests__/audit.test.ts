import { isoDate, ref } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { createInMemoryRuleAudit, type RuleAuditInput } from '../audit';

const base: RuleAuditInput = { ruleId: 'deposit', ruleName: 'Deposit note', category: 'gate', trigger: 'rental.created', action: 'create_rental' };

async function seeded() {
  let n = 0;
  const audit = createInMemoryRuleAudit({ now: () => isoDate(`2026-09-18T12:0${n++}:00Z`) });
  await audit.record(base);
  await audit.record({ ...base, ruleId: 'welcome', category: 'desk', trigger: 'session.start', suggestedActions: ['apply_loyalty_rate'] });
  await audit.record({ ...base, subject: ref('Rental', 'r-1'), success: false, error: 'declined' });
  await audit.record({ ...base, sessionId: 's-1' });
  await audit.record({ ...base, trigger: 'rental.returned' });
  return audit;
}

describe('createInMemoryRuleAudit', () => {
  it('records with generated id, timestamp, and defaults', async () => {
    const audit = createInMemoryRuleAudit({ now: () => isoDate('2026-09-18T12:00:00Z') });
    const e = await audit.record(base);
    expect(e.id).toMatch(/[0-9a-f-]{36}/);
    expect(e).toMatchObject({ at: '2026-09-18T12:00:00.000Z', success: true, conditionsMatched: {}, suggestedActions: [] });
  });

  it('records an outcome', async () => {
    const audit = await seeded();
    const first = (await audit.query({ trigger: 'session.start' })).entries[0]!;
    const updated = await audit.outcome(first.id, 'apply_loyalty_rate');
    expect(updated).toMatchObject({ userChoice: 'apply_loyalty_rate', success: true });
    expect(await audit.outcome('nope', 'x')).toBeUndefined();
  });

  it('queries newest first with filters and pagination', async () => {
    const audit = await seeded();
    const all = await audit.query();
    expect(all.total).toBe(5);
    expect(all.entries.map((e) => e.at)).toEqual([...all.entries.map((e) => e.at)].sort().reverse());
    expect((await audit.query({ ruleId: 'welcome' })).total).toBe(1);
    expect((await audit.query({ category: 'gate' })).total).toBe(4);
    expect((await audit.query({ trigger: 'rental.created' })).total).toBe(3);
    expect((await audit.query({ subject: ref('Rental', 'r-1') })).total).toBe(1);
    expect((await audit.query({ sessionId: 's-1' })).total).toBe(1);
    expect((await audit.query({ success: false })).total).toBe(1);
    expect((await audit.query({ from: isoDate('2026-09-18T12:03:00Z') })).total).toBe(2);
    expect((await audit.query({ to: isoDate('2026-09-18T12:01:00Z') })).total).toBe(2);
    const page = await audit.query({}, { limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const last = await audit.query({}, { limit: 2, offset: 4 });
    expect(last.entries).toHaveLength(1);
    expect(last.hasMore).toBe(false);
  });

  it('computes stats', async () => {
    const audit = await seeded();
    expect(await audit.stats()).toEqual({ total: 5, byCategory: { gate: 4, desk: 1 }, byTrigger: { 'rental.created': 3, 'session.start': 1, 'rental.returned': 1 }, successRate: 0.8 });
    expect((await audit.stats({ ruleId: 'none' })).successRate).toBe(1);
  });
});
