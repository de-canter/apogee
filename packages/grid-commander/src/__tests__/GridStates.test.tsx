import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GridSkeleton } from '../components/GridSkeleton';
import { GridEmptyState } from '../components/GridEmptyState';
import { CommandGrid } from '../components/CommandGrid';
import type { CommandColumnDef } from '../types/column';
import type { RowColorRule } from '../types/grid-states';

interface TestRow {
  id: string;
  name: string;
  status: string;
  priority: number;
}

const testColumns: CommandColumnDef<TestRow>[] = [
  { id: 'name', header: 'Name' },
  { id: 'status', header: 'Status' },
  { id: 'priority', header: 'Priority' },
];

const testData: TestRow[] = [
  { id: '1', name: 'Alpha', status: 'active', priority: 1 },
  { id: '2', name: 'Beta', status: 'inactive', priority: 2 },
  { id: '3', name: 'Gamma', status: 'active', priority: 3 },
];

describe('GridSkeleton', () => {
  it('renders correct number of rows', () => {
    const { container } = render(<GridSkeleton rows={5} columns={3} />);
    expect(container.querySelectorAll('.gc-skeleton-row')).toHaveLength(5);
  });

  it('renders correct number of columns per row', () => {
    const { container } = render(<GridSkeleton rows={2} columns={4} />);
    const firstRow = container.querySelector('.gc-skeleton-row')!;
    expect(firstRow.querySelectorAll('.gc-skeleton-cell')).toHaveLength(4);
  });

  it('uses default rows and columns', () => {
    const { container } = render(<GridSkeleton />);
    expect(container.querySelectorAll('.gc-skeleton-row')).toHaveLength(8);
    const firstRow = container.querySelector('.gc-skeleton-row')!;
    expect(firstRow.querySelectorAll('.gc-skeleton-cell')).toHaveLength(5);
  });

  it('respects density for row height', () => {
    const { container: compact } = render(<GridSkeleton density="compact" rows={1} columns={1} />);
    const { container: expanded } = render(<GridSkeleton density="expanded" rows={1} columns={1} />);
    const compactRow = compact.querySelector('.gc-skeleton-row') as HTMLElement;
    const expandedRow = expanded.querySelector('.gc-skeleton-row') as HTMLElement;
    expect(compactRow.style.height).toBe('28px');
    expect(expandedRow.style.height).toBe('48px');
  });

  it('has accessible role and label', () => {
    render(<GridSkeleton />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('GridEmptyState', () => {
  it('renders default title and description', () => {
    render(<GridEmptyState />);
    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.getByText('No rows match the current filters.')).toBeInTheDocument();
  });

  it('renders custom title and description', () => {
    render(<GridEmptyState title="Empty" description="Nothing here" />);
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders custom action', () => {
    render(<GridEmptyState action={<button>Add Item</button>} />);
    expect(screen.getByText('Add Item')).toBeInTheDocument();
  });

  it('renders custom icon', () => {
    render(<GridEmptyState icon={<span data-testid="custom-icon">X</span>} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});

describe('CommandGrid — Loading & Empty States', () => {
  it('shows skeleton when loading', () => {
    const { container } = render(
      <CommandGrid
        data={[]}
        columns={testColumns}
        getRowId={(r) => r.id}
        loading={true}
      />
    );
    expect(container.querySelector('.gc-skeleton')).toBeInTheDocument();
    expect(container.querySelector('.gc-table')).not.toBeInTheDocument();
  });

  it('shows empty state when no data and not loading', () => {
    render(
      <CommandGrid
        data={[]}
        columns={testColumns}
        getRowId={(r) => r.id}
        loading={false}
      />
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('shows custom empty state', () => {
    render(
      <CommandGrid
        data={[]}
        columns={testColumns}
        getRowId={(r) => r.id}
        emptyState={<div>Custom empty</div>}
      />
    );
    expect(screen.getByText('Custom empty')).toBeInTheDocument();
  });
});

describe('CommandGrid — Row Styling', () => {
  it('applies rowClassName string to all rows', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        rowClassName="custom-row"
      />
    );
    const rows = container.querySelectorAll('.gc-row');
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      expect(row.classList.contains('custom-row')).toBe(true);
    });
  });

  it('applies rowClassName function per row', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        rowClassName={(row) => `priority-${row.priority}`}
      />
    );
    const rows = container.querySelectorAll('.gc-row');
    expect(rows[0].classList.contains('priority-1')).toBe(true);
    expect(rows[1].classList.contains('priority-2')).toBe(true);
    expect(rows[2].classList.contains('priority-3')).toBe(true);
  });

  it('applies first matching rowColorRule', () => {
    const rules: RowColorRule<TestRow>[] = [
      {
        match: (row) => row.status === 'active',
        className: 'rule-active',
        style: { color: 'green' },
      },
      {
        match: (row) => row.priority > 1,
        className: 'rule-high',
      },
    ];

    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        rowColorRules={rules}
      />
    );

    const rows = container.querySelectorAll('.gc-row');
    // Alpha: active, matches first rule
    expect(rows[0].classList.contains('rule-active')).toBe(true);
    // Beta: inactive + priority 2, matches second rule only
    expect(rows[1].classList.contains('rule-high')).toBe(true);
    expect(rows[1].classList.contains('rule-active')).toBe(false);
    // Gamma: active + priority 3, matches first rule (first match wins)
    expect(rows[2].classList.contains('rule-active')).toBe(true);
  });
});
