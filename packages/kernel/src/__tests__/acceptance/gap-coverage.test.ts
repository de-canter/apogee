import { describe, expect, it } from 'vitest';
import { asOf, isoDate } from '../../time';

type Instrument = { id: string; kind: 'deed' | 'lien'; validFrom: string; validTo?: string; recordedAt: string; supersededAt?: string };

describe('Gap coverage: what did we know at commitment vs at policy', () => {
  // Search ran Feb 1 with an effective date of Jan 28. A judgment lien was
  // recorded at the county on Jan 30 but did not appear in the index until Feb 5.
  const index: Instrument[] = [
    { id: 'deed-2019', kind: 'deed', validFrom: isoDate('2019-06-01'), recordedAt: isoDate('2019-06-03') },
    { id: 'lien-judgment', kind: 'lien', validFrom: isoDate('2026-01-30'), recordedAt: isoDate('2026-02-05') },
  ];
  const liens = index.filter((i) => i.kind === 'lien');

  it('the commitment (searched Feb 1) correctly shows no lien', () => {
    expect(asOf(liens, { valid: isoDate('2026-01-28'), recorded: isoDate('2026-02-01') })).toBeUndefined();
  });
  it('the bring-down (searched Mar 1, effective Feb 28) surfaces the lien', () => {
    expect(asOf(liens, { valid: isoDate('2026-02-28'), recorded: isoDate('2026-03-01') })?.id).toBe('lien-judgment');
  });
  it('a valid-time query before the lien attached never shows it, regardless of record time', () => {
    expect(asOf(liens, { valid: isoDate('2026-01-29'), recorded: isoDate('2099-01-01') })).toBeUndefined();
  });
});
