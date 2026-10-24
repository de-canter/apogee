import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CountdownCell } from '../components/renderers/CountdownCell';
import { builtInRenderers } from '../components/renderers/registry';

const config = {
  daysField: 'closingInDays',
  variantField: 'bucket',
  variants: { OVERDUE: 'critical', TODAY: 'critical', THIS_WEEK: 'warning', LATER: 'ok', NONE: 'none' },
};
const cell = (row: Record<string, unknown>) =>
  render(<CountdownCell value={row.closingInDays} row={row} config={config} columnId="closing" />).container.firstElementChild as HTMLElement;

describe('countdown renderer (driven by published numbers, never a date)', () => {
  it('is registered', () => {
    expect(builtInRenderers.countdown).toBe(CountdownCell);
  });
  it('renders overdue, today, future and empty from the row fields and the published variant', () => {
    const overdue = cell({ closingInDays: -2, bucket: 'OVERDUE' });
    expect(overdue.textContent).toBe('2d overdue');
    expect(overdue).toHaveClass('gc-countdown--critical');
    expect(cell({ closingInDays: 0, bucket: 'TODAY' }).textContent).toBe('Today');
    const later = cell({ closingInDays: 12, bucket: 'LATER' });
    expect(later.textContent).toBe('12d');
    expect(later).toHaveClass('gc-countdown--ok');
    expect(cell({ closingInDays: null, bucket: 'NONE' }).textContent).toBe('—');
  });
  it('falls back to day thresholds when no variant field is given, and honours doneLabel', () => {
    const r = render(<CountdownCell value={2} row={{ closingInDays: 2 }} config={{ daysField: 'closingInDays' }} columnId="c" />);
    expect(r.container.firstElementChild).toHaveClass('gc-countdown--warning');
    const d = render(<CountdownCell value={5} row={{ closingInDays: 5, state: 'done' }} config={{ daysField: 'closingInDays', variantField: 'state', variants: { done: 'done' }, doneLabel: 'Closed' }} columnId="c" />);
    expect(d.container.textContent).toBe('Closed');
  });
});
