import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CollapsibleSection } from '../components/detail/CollapsibleSection';
import { SummaryChip } from '../components/detail/SummaryChip';
import { StatusBadge } from '../components/detail/StatusBadge';
import { ActionButton } from '../components/detail/ActionButton';

describe('CollapsibleSection', () => {
  it('renders expanded by default', () => {
    render(
      <CollapsibleSection title="Details">
        <p>Content here</p>
      </CollapsibleSection>
    );

    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Content here')).toBeInTheDocument();
  });

  it('collapses on click', () => {
    const onToggle = vi.fn();
    render(
      <CollapsibleSection title="Details" onToggle={onToggle}>
        <p>Content here</p>
      </CollapsibleSection>
    );

    fireEvent.click(screen.getByText('Details'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('starts collapsed when defaultOpen is false', () => {
    const { container } = render(
      <CollapsibleSection title="Details" defaultOpen={false}>
        <p>Content here</p>
      </CollapsibleSection>
    );

    // Content should be hidden via max-height: 0
    const content = container.querySelector('.gc-section-content');
    expect(content).toHaveStyle({ maxHeight: '0' });
  });

  it('shows summary content when collapsed', () => {
    render(
      <CollapsibleSection
        title="Details"
        defaultOpen={false}
        summaryContent="3 items"
      >
        <p>Content here</p>
      </CollapsibleSection>
    );

    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('renders badge', () => {
    render(
      <CollapsibleSection title="Details" badge={<span>5</span>}>
        <p>Content here</p>
      </CollapsibleSection>
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders actions slot', () => {
    render(
      <CollapsibleSection title="Details" actions={<button>Add</button>}>
        <p>Content here</p>
      </CollapsibleSection>
    );

    expect(screen.getByText('Add')).toBeInTheDocument();
  });
});

describe('SummaryChip', () => {
  it('renders label and value', () => {
    render(<SummaryChip label="Status" value="Open" />);
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('applies custom color', () => {
    const { container } = render(
      <SummaryChip label="Status" value="Open" color="#16a34a" />
    );
    const chip = container.querySelector('.gc-summary-chip');
    expect(chip).toHaveStyle({ color: '#16a34a' });
  });
});

describe('StatusBadge', () => {
  it('renders text', () => {
    render(<StatusBadge text="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders numeric count', () => {
    render(<StatusBadge text={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('applies colors', () => {
    const { container } = render(
      <StatusBadge text="Error" color="#dc2626" backgroundColor="#fee2e2" />
    );
    const badge = container.querySelector('.gc-status-badge');
    expect(badge).toHaveStyle({ color: '#dc2626', backgroundColor: '#fee2e2' });
  });
});

describe('ActionButton', () => {
  it('renders label and calls onClick', () => {
    const onClick = vi.fn();
    render(<ActionButton label="Save" onClick={onClick} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders disabled state', () => {
    render(<ActionButton label="Save" onClick={vi.fn()} disabled />);
    expect(screen.getByText('Save').closest('button')).toBeDisabled();
  });

  it('renders variant classes', () => {
    const { container } = render(
      <ActionButton label="Delete" onClick={vi.fn()} variant="danger" />
    );
    expect(container.querySelector('.gc-action-btn--danger')).not.toBeNull();
  });

  it('renders small size', () => {
    const { container } = render(
      <ActionButton label="Go" onClick={vi.fn()} size="small" />
    );
    expect(container.querySelector('.gc-action-btn--small')).not.toBeNull();
  });

  it('renders icon', () => {
    const { container } = render(
      <ActionButton label="Save" onClick={vi.fn()} icon="+" />
    );
    const icon = container.querySelector('.gc-action-btn-icon');
    expect(icon).not.toBeNull();
    expect(icon!.textContent).toBe('+');
  });
});
