import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InlineActionsCell } from '../components/renderers/InlineActionsCell';

const testRow = { id: '1', name: 'Test Order', status: 'Open' };

describe('InlineActionsCell', () => {
  it('renders action buttons', () => {
    const actions = [
      { id: 'view', label: 'View', handler: vi.fn() },
      { id: 'edit', label: 'Edit', handler: vi.fn() },
    ];

    render(
      <InlineActionsCell
        value={null}
        row={testRow}
        config={{ actions }}
        columnId="actions"
      />
    );

    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('calls handler on click and stops propagation', () => {
    const handler = vi.fn();
    const actions = [{ id: 'view', label: 'View', handler }];

    render(
      <InlineActionsCell
        value={null}
        row={testRow}
        config={{ actions }}
        columnId="actions"
      />
    );

    const btn = screen.getByText('View');
    const clickEvent = new MouseEvent('click', { bubbles: true });
    const stopProp = vi.spyOn(clickEvent, 'stopPropagation');
    btn.dispatchEvent(clickEvent);

    expect(handler).toHaveBeenCalledWith(testRow);
  });

  it('hides actions when visible returns false', () => {
    const actions = [
      { id: 'view', label: 'View', handler: vi.fn(), visible: () => false },
      { id: 'edit', label: 'Edit', handler: vi.fn() },
    ];

    render(
      <InlineActionsCell
        value={null}
        row={testRow}
        config={{ actions }}
        columnId="actions"
      />
    );

    expect(screen.queryByText('View')).not.toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('disables buttons when disabled returns true', () => {
    const handler = vi.fn();
    const actions = [
      { id: 'view', label: 'View', handler, disabled: () => true },
    ];

    render(
      <InlineActionsCell
        value={null}
        row={testRow}
        config={{ actions }}
        columnId="actions"
      />
    );

    const btn = screen.getByText('View').closest('button');
    expect(btn).toBeDisabled();
  });

  it('renders variant classes', () => {
    const actions = [
      { id: 'delete', label: 'Delete', handler: vi.fn(), variant: 'danger' as const },
    ];

    const { container } = render(
      <InlineActionsCell
        value={null}
        row={testRow}
        config={{ actions }}
        columnId="actions"
      />
    );

    expect(container.querySelector('.gc-inline-action--danger')).not.toBeNull();
  });

  it('renders icons', () => {
    const actions = [
      { id: 'view', label: 'View', icon: '\u{1F441}', handler: vi.fn() },
    ];

    render(
      <InlineActionsCell
        value={null}
        row={testRow}
        config={{ actions }}
        columnId="actions"
      />
    );

    expect(screen.getByText('\u{1F441}')).toBeInTheDocument();
  });

  it('returns null when no actions are visible', () => {
    const { container } = render(
      <InlineActionsCell
        value={null}
        row={testRow}
        config={{ actions: [] }}
        columnId="actions"
      />
    );

    expect(container.innerHTML).toBe('');
  });
});
