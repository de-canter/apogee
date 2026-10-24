import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { useRowSelection } from '../hooks/useRowSelection';
import { CheckboxCell } from '../components/renderers/CheckboxCell';
import { BatchActionBar } from '../components/BatchActionBar';

describe('useRowSelection', () => {
  const filteredRowIds = ['a', 'b', 'c', 'd', 'e'];

  it('toggleRow adds and removes', () => {
    const { result } = renderHook(() =>
      useRowSelection({ filteredRowIds })
    );
    act(() => result.current.toggleRow('b'));
    expect(result.current.isSelected('b')).toBe(true);
    expect(result.current.selectedCount).toBe(1);

    act(() => result.current.toggleRow('b'));
    expect(result.current.isSelected('b')).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('toggleAll selects all, then clears', () => {
    const { result } = renderHook(() =>
      useRowSelection({ filteredRowIds })
    );
    act(() => result.current.toggleAll());
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.selectedCount).toBe(5);

    act(() => result.current.toggleAll());
    expect(result.current.isAllSelected).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it('selectRange selects inclusive range', () => {
    const { result } = renderHook(() =>
      useRowSelection({ filteredRowIds })
    );
    act(() => result.current.selectRange('b', 'd'));
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.isSelected('b')).toBe(true);
    expect(result.current.isSelected('c')).toBe(true);
    expect(result.current.isSelected('d')).toBe(true);
    expect(result.current.isSelected('e')).toBe(false);
  });

  it('clearSelection empties set', () => {
    const { result } = renderHook(() =>
      useRowSelection({ filteredRowIds })
    );
    act(() => result.current.toggleRow('a'));
    act(() => result.current.toggleRow('c'));
    expect(result.current.selectedCount).toBe(2);

    act(() => result.current.clearSelection());
    expect(result.current.selectedCount).toBe(0);
  });

  it('isAllSelected and isPartiallySelected computed correctly', () => {
    const { result } = renderHook(() =>
      useRowSelection({ filteredRowIds })
    );
    // No selection
    expect(result.current.isAllSelected).toBe(false);
    expect(result.current.isPartiallySelected).toBe(false);

    // Partial
    act(() => result.current.toggleRow('a'));
    expect(result.current.isAllSelected).toBe(false);
    expect(result.current.isPartiallySelected).toBe(true);

    // All
    act(() => {
      result.current.toggleRow('b');
      result.current.toggleRow('c');
      result.current.toggleRow('d');
      result.current.toggleRow('e');
    });
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.isPartiallySelected).toBe(false);
  });
});

describe('CheckboxCell', () => {
  it('renders checkbox', () => {
    const { container } = render(
      <CheckboxCell
        value={null}
        row={{}}
        columnId="sel"
        config={{ isSelected: false, onToggle: vi.fn() }}
      />
    );
    expect(container.querySelector('input[type="checkbox"]')).toBeInTheDocument();
  });

  it('header shows indeterminate when partial', () => {
    const { container } = render(
      <CheckboxCell
        value={null}
        row={{}}
        columnId="sel"
        config={{
          isHeader: true,
          isAllSelected: false,
          isPartiallySelected: true,
          onToggleAll: vi.fn(),
        }}
      />
    );
    const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
  });

  it('click toggles selection', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <CheckboxCell
        value={null}
        row={{}}
        columnId="sel"
        config={{ isSelected: false, onToggle }}
      />
    );
    const input = container.querySelector('input[type="checkbox"]')!;
    fireEvent.click(input);
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('BatchActionBar', () => {
  const mockHandler = vi.fn();
  const actions = [
    { id: 'delete', label: 'Delete', variant: 'danger' as const, handler: mockHandler },
    { id: 'archive', label: 'Archive', handler: mockHandler, minSelection: 2 },
  ];

  it('renders when items selected', () => {
    render(
      <BatchActionBar
        selectedCount={3}
        selectedIds={['a', 'b', 'c']}
        selectedRows={[]}
        actions={actions}
        onClearSelection={vi.fn()}
      />
    );
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
  });

  it('hides when no selection', () => {
    const { container } = render(
      <BatchActionBar
        selectedCount={0}
        selectedIds={[]}
        selectedRows={[]}
        actions={actions}
        onClearSelection={vi.fn()}
      />
    );
    expect(container.querySelector('.gc-batch-bar')).not.toBeInTheDocument();
  });

  it('disables actions below minSelection', () => {
    render(
      <BatchActionBar
        selectedCount={1}
        selectedIds={['a']}
        selectedRows={[]}
        actions={actions}
        onClearSelection={vi.fn()}
      />
    );
    // 'Archive' requires minSelection: 2
    const archiveBtn = screen.getByText('Archive').closest('button');
    expect(archiveBtn).toBeDisabled();
    // 'Delete' has default minSelection: 1
    const deleteBtn = screen.getByText('Delete').closest('button');
    expect(deleteBtn).not.toBeDisabled();
  });

  it('fires handler with selected IDs', () => {
    render(
      <BatchActionBar
        selectedCount={2}
        selectedIds={['a', 'b']}
        selectedRows={[]}
        actions={actions}
        onClearSelection={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Delete'));
    expect(mockHandler).toHaveBeenCalledWith(['a', 'b'], []);
  });
});
