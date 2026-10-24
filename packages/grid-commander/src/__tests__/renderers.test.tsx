import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { TextCell } from '../components/renderers/TextCell';
import { LinkCell } from '../components/renderers/LinkCell';
import { TwoLineCell } from '../components/renderers/TwoLineCell';
import { DeadlineCell } from '../components/renderers/DeadlineCell';
import { StatusPillCell } from '../components/renderers/StatusPillCell';
import { CountBadgeCell } from '../components/renderers/CountBadgeCell';
import { PriorityIconCell } from '../components/renderers/PriorityIconCell';
import { CurrencyCell } from '../components/renderers/CurrencyCell';
import { StalenessCell } from '../components/renderers/StalenessCell';
import { DateCell } from '../components/renderers/DateCell';
import { BooleanCheckCell } from '../components/renderers/BooleanCheckCell';
import { createRendererRegistry, getRenderer } from '../components/renderers/registry';

const baseProps = { row: {}, config: {}, columnId: 'test' };

describe('TextCell', () => {
  it('renders text value', () => {
    render(<TextCell value="Hello World" {...baseProps} />);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders empty string for null', () => {
    const { container } = render(<TextCell value={null} {...baseProps} />);
    expect(container.querySelector('.gc-cell-text')?.textContent).toBe('');
  });
});

describe('LinkCell', () => {
  it('renders clickable text', () => {
    const onClick = vi.fn();
    render(<LinkCell value="TP-2024-001" {...baseProps} config={{ onClick }} />);
    const link = screen.getByText('TP-2024-001');
    expect(link).toHaveClass('gc-cell-link');
    link.click();
    expect(onClick).toHaveBeenCalledWith('TP-2024-001', {});
  });

  it('passes the row to onClick so a consumer can open that file (#845)', () => {
    const onClick = vi.fn();
    const row = { id: 'order-1', orderNumber: 'TP-2024-001' };
    render(<LinkCell value="TP-2024-001" row={row} config={{ onClick }} columnId="orderNumber" />);
    screen.getByText('TP-2024-001').click();
    expect(onClick).toHaveBeenCalledWith('TP-2024-001', row);
  });
});

describe('TwoLineCell', () => {
  it('renders primary and secondary lines', () => {
    render(
      <TwoLineCell
        value="123 Main St"
        row={{ address: '123 Main St', city: 'Dallas', county: 'Collin' }}
        config={{
          primaryField: 'address',
          secondaryField: 'city',
        }}
        columnId="test"
      />
    );
    expect(screen.getByText('123 Main St')).toBeInTheDocument();
    expect(screen.getByText('Dallas')).toBeInTheDocument();
  });

  it('supports function secondaryField', () => {
    render(
      <TwoLineCell
        value="123 Main St"
        row={{ city: 'Dallas', county: 'Collin' }}
        config={{
          secondaryField: (row: unknown) => { const r = row as { city: string; county: string }; return `${r.city}, ${r.county}`; },
        }}
        columnId="test"
      />
    );
    expect(screen.getByText('Dallas, Collin')).toBeInTheDocument();
  });

  it('accepts secondaryAccessor as an alias for secondaryField (#844)', () => {
    render(
      <TwoLineCell
        value="John Smith"
        row={{ buyerName: 'John Smith', sellerName: 'Jane Doe' }}
        config={{ secondaryAccessor: (row: unknown) => (row as { sellerName: string }).sellerName }}
        columnId="buyerName"
      />
    );
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('accepts a field name for secondaryAccessor', () => {
    render(
      <TwoLineCell
        value="John Smith"
        row={{ sellerName: 'Jane Doe' }}
        config={{ secondaryAccessor: 'sellerName' }}
        columnId="buyerName"
      />
    );
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });
});

describe('DeadlineCell', () => {
  it('renders formatted date', () => {
    // Future date
    const future = new Date();
    future.setDate(future.getDate() + 10);
    render(
      <DeadlineCell
        value={future.toISOString()}
        config={{ showCountdown: true, warningDays: 7, criticalDays: 3 }}
        row={{}}
        columnId="test"
      />
    );
    expect(screen.getByText('10d')).toBeInTheDocument();
  });

  it('shows TODAY for today\'s date', () => {
    render(
      <DeadlineCell
        value={new Date().toISOString()}
        config={{ showCountdown: true }}
        row={{}}
        columnId="test"
      />
    );
    expect(screen.getByText('TODAY')).toBeInTheDocument();
  });

  it('shows late for past dates', () => {
    const past = new Date();
    past.setDate(past.getDate() - 5);
    render(
      <DeadlineCell
        value={past.toISOString()}
        config={{ showCountdown: true }}
        row={{}}
        columnId="test"
      />
    );
    expect(screen.getByText('5d late')).toBeInTheDocument();
  });

  it('counts from the current date', () => {
    // Business today is Tue Oct 6 while the wall clock reads Fri Oct 9: a file
    // closing on the 6th is TODAY, not "3d late"
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 10, 0));
    try {
      const { rerender } = render(
        <DeadlineCell value="2026-10-06" config={{ showCountdown: true }} row={{}} columnId="test" />
      );
      expect(screen.getByText('TODAY')).toBeInTheDocument();
      rerender(<DeadlineCell value="2026-10-08" config={{ showCountdown: true }} row={{}} columnId="test" />);
      expect(screen.getByText('2d')).toBeInTheDocument();
      rerender(<DeadlineCell value="2026-10-05" config={{ showCountdown: true }} row={{}} columnId="test" />);
      expect(screen.getByText('1d late')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders em dash for null value', () => {
    const { container } = render(
      <DeadlineCell value={null} config={{}} row={{}} columnId="test" />
    );
    expect(container.textContent).toBe('\u2014');
  });
});

describe('StatusPillCell', () => {
  it('renders colored pill', () => {
    render(
      <StatusPillCell
        value="In Exam"
        config={{ colorMap: { 'In Exam': '#9b59b6' } }}
        row={{}}
        columnId="test"
      />
    );
    const pill = screen.getByText('In Exam');
    expect(pill).toHaveClass('gc-cell-pill');
    // JSDOM converts hex to rgb
    expect(pill.style.color).toBe('rgb(155, 89, 182)');
  });
});

describe('CountBadgeCell', () => {
  it('renders badge with count', () => {
    render(
      <CountBadgeCell
        value={3}
        config={{
          thresholds: [
            { max: 0, color: 'green', display: '\u2713' },
            { max: 5, color: 'orange' },
          ],
        }}
        row={{}}
        columnId="test"
      />
    );
    expect(screen.getByText('3')).toHaveClass('gc-cell-badge');
  });

  it('renders display for zero count', () => {
    render(
      <CountBadgeCell
        value={0}
        config={{
          thresholds: [
            { max: 0, color: 'green', display: '\u2713' },
            { max: 5, color: 'orange' },
          ],
        }}
        row={{}}
        columnId="test"
      />
    );
    expect(screen.getByText('\u2713')).toBeInTheDocument();
  });
});

describe('PriorityIconCell', () => {
  it('renders empty for normal priority', () => {
    const { container } = render(
      <PriorityIconCell value="normal" config={{}} row={{}} columnId="test" />
    );
    expect(container.textContent).toBe('');
  });

  it('renders icon for urgent priority', () => {
    const { container } = render(
      <PriorityIconCell value="urgent" config={{}} row={{}} columnId="test" />
    );
    expect(container.textContent).toBe('\u25CF');
    expect((container.firstChild as HTMLElement).style.color).toBe('var(--gc-red)');
  });
});

describe('CurrencyCell', () => {
  it('renders formatted currency', () => {
    render(<CurrencyCell value={250000} config={{}} row={{}} columnId="test" />);
    expect(screen.getByText('$250,000.00')).toBeInTheDocument();
  });

  it('renders em dash for null', () => {
    const { container } = render(
      <CurrencyCell value={null} config={{}} row={{}} columnId="test" />
    );
    expect(container.textContent).toBe('\u2014');
  });

  it('lets config.formatValue replace the figure with a word, and falls through on undefined (#911)', () => {
    const formatValue = (v: number, row: { vendorName?: string }) => (!row.vendorName && !v ? 'Cash' : undefined);
    const { container, rerender } = render(
      <CurrencyCell value={0} config={{ formatValue }} row={{ vendorName: '' }} columnId="test" />
    );
    expect(container.textContent).toBe('Cash');
    rerender(<CurrencyCell value={388000} config={{ formatValue }} row={{ vendorName: 'Frontier' }} columnId="test" />);
    expect(container.textContent).toBe('$388,000.00');
  });
});

describe('DateCell', () => {
  it('renders a plain date with no colour and an em dash when empty', () => {
    const { container, rerender } = render(<DateCell value="2026-09-30T12:00:00Z" config={{}} row={{}} columnId="test" />);
    const span = container.querySelector('span') as HTMLSpanElement;
    expect(span.textContent).toBe('09/30/26');
    expect(span.style.color).toBe('');
    rerender(<DateCell value={null} config={{}} row={{}} columnId="test" />);
    expect(container.textContent).toBe('\u2014');
  });
});

describe('StalenessCell', () => {
  it('renders "today" for today', () => {
    render(
      <StalenessCell
        value={new Date().toISOString()}
        config={{}}
        row={{}}
        columnId="test"
      />
    );
    expect(screen.getByText('today')).toBeInTheDocument();
  });

  it('renders days ago', () => {
    const past = new Date();
    past.setDate(past.getDate() - 3);
    render(
      <StalenessCell
        value={past.toISOString()}
        config={{}}
        row={{}}
        columnId="test"
      />
    );
    expect(screen.getByText('3d ago')).toBeInTheDocument();
  });

  it('renders config.emptyLabel instead of a dash when there is no value (#921)', () => {
    const { container, rerender } = render(
      <StalenessCell value={-1} config={{ emptyLabel: 'Never contacted' }} row={{}} columnId="test" />
    );
    expect(container.textContent).toBe('Never contacted');
    rerender(<StalenessCell value={undefined} config={{}} row={{}} columnId="test" />);
    expect(container.textContent).toBe('—');
  });
});

describe('BooleanCheckCell', () => {
  it('renders check for true', () => {
    const { container } = render(
      <BooleanCheckCell value={true} config={{}} row={{}} columnId="test" />
    );
    expect(container.textContent).toBe('\u2713');
  });

  it('renders X for false', () => {
    const { container } = render(
      <BooleanCheckCell value={false} config={{}} row={{}} columnId="test" />
    );
    expect(container.textContent).toBe('\u2715');
  });
});

describe('Registry', () => {
  it('creates registry with all built-in renderers', () => {
    const registry = createRendererRegistry();
    expect(Object.keys(registry)).toHaveLength(14);
    expect(registry.countdown).toBeDefined();
    expect(registry.date).toBeDefined();
    expect(registry.text).toBeDefined();
    expect(registry.link).toBeDefined();
    expect(registry['two-line']).toBeDefined();
    expect(registry.deadline).toBeDefined();
    expect(registry['status-pill']).toBeDefined();
    expect(registry['count-badge']).toBeDefined();
    expect(registry['priority-icon']).toBeDefined();
    expect(registry.currency).toBeDefined();
    expect(registry.staleness).toBeDefined();
    expect(registry['boolean-check']).toBeDefined();
    expect(registry['inline-actions']).toBeDefined();
    expect(registry.checkbox).toBeDefined();
  });

  it('merges custom renderers', () => {
    const custom = { 'my-renderer': () => null };
    const registry = createRendererRegistry(custom);
    expect(registry['my-renderer']).toBe(custom['my-renderer']);
    expect(registry.text).toBeDefined();
  });

  it('falls back to text for unknown renderer', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = createRendererRegistry();
    const renderer = getRenderer(registry, 'unknown-renderer');
    expect(renderer).toBe(registry.text);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns text renderer when name is undefined', () => {
    const registry = createRendererRegistry();
    const renderer = getRenderer(registry, undefined);
    expect(renderer).toBe(registry.text);
  });
});
