import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StalenessCell } from '../components/renderers/StalenessCell';
import type { CellRendererProps } from '../types/column';

function props(value: unknown, config: Record<string, unknown> = {}): CellRendererProps {
  return { value, row: {}, config, columnId: 'staleness' };
}

describe('StalenessCell', () => {
  it('renders an em dash for a missing value instead of "NaNd ago" (#735)', () => {
    expect(render(<StalenessCell {...props(undefined)} />).container.textContent).toBe('—');
    expect(render(<StalenessCell {...props(null)} />).container.textContent).toBe('—');
    expect(render(<StalenessCell {...props('')} />).container.textContent).toBe('—');
  });

  it('renders an em dash for the -1 "never contacted" sentinel', () => {
    expect(render(<StalenessCell {...props(-1)} />).container.textContent).toBe('—');
  });

  it('renders today / Nd ago for numeric day counts', () => {
    expect(render(<StalenessCell {...props(0)} />).container.textContent).toBe('today');
    expect(render(<StalenessCell {...props(5)} />).container.textContent).toBe('5d ago');
  });

  it('accepts an ISO date string', () => {
    const today = new Date().toISOString();
    expect(render(<StalenessCell {...props(today)} />).container.textContent).toBe('today');
  });
});
