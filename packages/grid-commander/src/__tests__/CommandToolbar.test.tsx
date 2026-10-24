import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandToolbar } from '../components/CommandToolbar';
import type { CommandColumnDef } from '../types/column';

interface TestRow {
  id: string;
  name: string;
}

const testColumns: CommandColumnDef<TestRow>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
];

const defaultProps = {
  rowCount: 100,
  filteredRowCount: 100,
  globalFilter: '',
  onGlobalFilterChange: vi.fn(),
  rowDensity: 'compact' as const,
  onCycleDensity: vi.fn(),
  columns: testColumns,
  columnVisibility: {},
  onColumnVisibilityChange: vi.fn(),
};

describe('CommandToolbar', () => {
  it('renders title and row count', () => {
    render(<CommandToolbar {...defaultProps} title="Orders" />);
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows filtered count when different from total', () => {
    render(<CommandToolbar {...defaultProps} filteredRowCount={42} />);
    expect(screen.getByText('42 of 100')).toBeInTheDocument();
  });

  it('renders search input when enableGlobalFilter is true', () => {
    render(<CommandToolbar {...defaultProps} enableGlobalFilter />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('debounces global filter changes', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <CommandToolbar {...defaultProps} enableGlobalFilter onGlobalFilterChange={onChange} />
    );

    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'test' } });

    // Not yet called
    expect(onChange).not.toHaveBeenCalled();

    // After debounce
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onChange).toHaveBeenCalledWith('test');

    vi.useRealTimers();
  });

  it('renders preset pills', () => {
    const presets = [
      { id: 'open', label: 'Open Only' },
      { id: 'urgent', label: 'Urgent' },
    ];
    const onPresetChange = vi.fn();

    render(
      <CommandToolbar {...defaultProps} presets={presets} onPresetChange={onPresetChange} />
    );
    expect(screen.getByText('Open Only')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Open Only'));
    expect(onPresetChange).toHaveBeenCalledWith(presets[0]);
  });

  it('highlights active preset', () => {
    const presets = [{ id: 'open', label: 'Open Only' }];
    const { container } = render(
      <CommandToolbar {...defaultProps} presets={presets} activePresetId="open" />
    );
    expect(container.querySelector('.gc-toolbar-preset--active')).not.toBeNull();
  });

  it('cycles density on button click', () => {
    const onCycleDensity = vi.fn();
    render(<CommandToolbar {...defaultProps} onCycleDensity={onCycleDensity} />);

    // Find density button by title
    const btn = screen.getByTitle('Row density: compact');
    fireEvent.click(btn);
    expect(onCycleDensity).toHaveBeenCalled();
  });

  it('toggles column config dropdown', () => {
    render(<CommandToolbar {...defaultProps} />);

    const btn = screen.getByTitle('Configure columns');
    fireEvent.click(btn);
    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('toggles column visibility via checkbox', () => {
    const onColumnVisibilityChange = vi.fn();
    render(
      <CommandToolbar
        {...defaultProps}
        onColumnVisibilityChange={onColumnVisibilityChange}
      />
    );

    // Open column config
    fireEvent.click(screen.getByTitle('Configure columns'));

    // Toggle checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onColumnVisibilityChange).toHaveBeenCalledWith({ name: false });
  });

  it('renders primary action button', () => {
    const onClick = vi.fn();
    render(
      <CommandToolbar
        {...defaultProps}
        primaryAction={{ label: 'New Order', onClick }}
      />
    );

    const btn = screen.getByText('New Order');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  // F650: Action buttons
  it('renders action buttons between presets and search', () => {
    const onClick = vi.fn();
    const actionButtons = [
      { id: 'new-file', label: '+ New File', icon: '+', shortcut: '\u2318N', accentColor: '#22c55e', onClick },
      { id: 'import', label: 'Import', icon: '\u2191', shortcut: '\u2318I', accentColor: '#3b82f6', onClick },
    ];

    render(<CommandToolbar {...defaultProps} actionButtons={actionButtons} />);

    expect(screen.getByText('+ New File')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('calls action button onClick', () => {
    const onClick1 = vi.fn();
    const onClick2 = vi.fn();
    const actionButtons = [
      { id: 'new', label: 'New', onClick: onClick1 },
      { id: 'import', label: 'Import', onClick: onClick2 },
    ];

    render(<CommandToolbar {...defaultProps} actionButtons={actionButtons} />);

    fireEvent.click(screen.getByText('New'));
    expect(onClick1).toHaveBeenCalledTimes(1);
    expect(onClick2).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Import'));
    expect(onClick2).toHaveBeenCalledTimes(1);
  });

  it('shows shortcut in action button title tooltip', () => {
    const actionButtons = [
      { id: 'new', label: 'New File', shortcut: '\u2318N', onClick: vi.fn() },
    ];

    render(<CommandToolbar {...defaultProps} actionButtons={actionButtons} />);

    const btn = screen.getByTitle('New File (\u2318N)');
    expect(btn).toBeInTheDocument();
  });

  it('disables action button when disabled is true', () => {
    const onClick = vi.fn();
    const actionButtons = [
      { id: 'new', label: 'New', onClick, disabled: true },
    ];

    render(<CommandToolbar {...defaultProps} actionButtons={actionButtons} />);

    const btn = screen.getByText('New').closest('button')!;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('puts an action button\'s testId and title on the button', () => {
    const actionButtons = [
      { id: 'pop', label: 'Pop Out', icon: '\u2197', testId: 'chain-popout-btn', title: 'Pop out to separate window', onClick: vi.fn() },
    ];

    render(<CommandToolbar {...defaultProps} actionButtons={actionButtons} />);

    const btn = screen.getByTestId('chain-popout-btn');
    expect(btn).toHaveTextContent('Pop Out');
    expect(btn).toHaveAttribute('title', 'Pop out to separate window');
  });

  it('applies accent color to action button icon', () => {
    const actionButtons = [
      { id: 'new', label: 'New', icon: '+', accentColor: '#22c55e', onClick: vi.fn() },
    ];

    const { container } = render(<CommandToolbar {...defaultProps} actionButtons={actionButtons} />);

    const icon = container.querySelector('.gc-toolbar-action-icon') as HTMLElement;
    expect(icon).not.toBeNull();
    // jsdom converts hex to rgb
    expect(icon.style.color).toBe('rgb(34, 197, 94)');
  });
});
