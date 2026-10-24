import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandGrid } from '../components/CommandGrid';
import type { CommandColumnDef } from '../types/column';

interface TestRow {
  id: string;
  name: string;
  status: string;
  amount: number;
}

const testData: TestRow[] = [
  { id: '1', name: 'Alpha Order', status: 'Open', amount: 1000 },
  { id: '2', name: 'Beta Order', status: 'Closed', amount: 2000 },
  { id: '3', name: 'Gamma Order', status: 'Open', amount: 3000 },
  { id: '4', name: 'Delta Order', status: 'Pending', amount: 500 },
];

const testColumns: CommandColumnDef<TestRow>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Name',
    size: 200,
    enableSorting: true,
    filterType: 'text',
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Status',
    size: 100,
    enableSorting: true,
    filterType: 'select',
    filterOptions: ['Open', 'Closed', 'Pending'],
    cellRenderer: 'status-pill',
    cellConfig: {
      colorMap: { Open: '#16a34a', Closed: '#6b7280', Pending: '#ca8a04' },
    },
  },
  {
    id: 'amount',
    accessorKey: 'amount',
    header: 'Amount',
    size: 100,
    align: 'right',
    enableSorting: true,
    cellRenderer: 'currency',
  },
];

describe('CommandGrid', () => {
  it('renders all rows', () => {
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    expect(screen.getByText('Alpha Order')).toBeInTheDocument();
    expect(screen.getByText('Beta Order')).toBeInTheDocument();
    expect(screen.getByText('Gamma Order')).toBeInTheDocument();
    expect(screen.getByText('Delta Order')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('uses cell renderers', () => {
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    // Status pill renderer
    const pills = screen.getAllByText('Open');
    expect(pills.length).toBeGreaterThanOrEqual(1);
    // Currency renderer
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
  });

  it('calls onRowSelect when row is clicked', () => {
    const onRowSelect = vi.fn();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        onRowSelect={onRowSelect}
      />
    );
    fireEvent.click(screen.getByText('Alpha Order'));
    expect(onRowSelect).toHaveBeenCalledWith(testData[0]);
  });

  it('highlights selected row', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        selectedRowId="2"
      />
    );
    const selectedRow = container.querySelector('.gc-row--selected');
    expect(selectedRow).not.toBeNull();
  });

  it('sorts by column on click', () => {
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    const nameHeader = screen.getByText('Name');
    fireEvent.click(nameHeader);
    // After sorting ascending, Alpha should be first
    const rows = screen.getAllByRole('row');
    // rows[0] = header, rows[1+] = data rows (no filter row)
    const firstDataRow = rows.find(
      (r) => r.classList.contains('gc-row') && r.textContent?.includes('Alpha')
    );
    expect(firstDataRow).toBeTruthy();
  });

  it('renders filter funnel icons for filterable columns', () => {
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    // Name column has filterType: 'text', Status has filterType: 'select'
    const filterBtns = screen.getAllByLabelText(/Filter .* column/);
    expect(filterBtns.length).toBe(2); // Name + Status (Amount has no filterType)
  });

  it('does not render filter row', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    expect(container.querySelector('.gc-filter-row')).toBeNull();
  });

  it('opens text filter popover on funnel click', () => {
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    // Click the funnel icon for Name column
    const nameFilterBtn = screen.getByLabelText('Filter Name column');
    fireEvent.click(nameFilterBtn);
    // Popover should show a text input
    const textFilter = screen.getByPlaceholderText('Filter...');
    expect(textFilter).toBeInTheDocument();
    // And sort buttons
    expect(screen.getByText(/Sort A/)).toBeInTheDocument();
  });

  it('opens select filter popover with options', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    // Click the funnel icon for Status column
    const statusFilterBtn = screen.getByLabelText('Filter Status column');
    fireEvent.click(statusFilterBtn);
    // Popover should show All + the 3 options
    const popover = container.querySelector('.gc-header-filter-popover');
    expect(popover).not.toBeNull();
    const options = popover!.querySelectorAll('.gc-header-filter-option');
    const optionTexts = Array.from(options).map((o) => o.textContent);
    expect(optionTexts).toContain('All');
    expect(optionTexts).toContain('Open');
    expect(optionTexts).toContain('Closed');
    expect(optionTexts).toContain('Pending');
  });

  it('filters rows via select popover option click', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    // Open Status filter popover
    const statusFilterBtn = screen.getByLabelText('Filter Status column');
    fireEvent.click(statusFilterBtn);
    // Click "Open" option within the popover
    const popover = container.querySelector('.gc-header-filter-popover')!;
    const openOption = Array.from(popover.querySelectorAll('.gc-header-filter-option'))
      .find((o) => o.textContent === 'Open')!;
    fireEvent.click(openOption);
    // Only Open rows should remain
    expect(screen.getByText('Alpha Order')).toBeInTheDocument();
    expect(screen.getByText('Gamma Order')).toBeInTheDocument();
    expect(screen.queryByText('Beta Order')).not.toBeInTheDocument();
  });

  it('filters rows on text input with debounce', async () => {
    vi.useFakeTimers();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    // Open Name filter popover
    const nameFilterBtn = screen.getByLabelText('Filter Name column');
    fireEvent.click(nameFilterBtn);
    // Type into the text input
    const textFilter = screen.getByPlaceholderText('Filter...');
    fireEvent.change(textFilter, { target: { value: 'Alpha' } });
    // Advance past debounce
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.getByText('Alpha Order')).toBeInTheDocument();
    expect(screen.queryByText('Beta Order')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders with different row densities', () => {
    const { container, rerender } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        rowDensity="compact"
      />
    );
    expect(container.querySelector('.gc-density-compact')).not.toBeNull();

    rerender(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        rowDensity="comfortable"
      />
    );
    expect(container.querySelector('.gc-density-comfortable')).not.toBeNull();

    rerender(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        rowDensity="expanded"
      />
    );
    expect(container.querySelector('.gc-density-expanded')).not.toBeNull();
  });

  it('renders empty state when no data', () => {
    render(
      <CommandGrid
        data={[]}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('supports custom renderers', () => {
    const customColumns: CommandColumnDef<TestRow>[] = [
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        cellRenderer: 'custom-bold',
      },
    ];
    render(
      <CommandGrid
        data={testData}
        columns={customColumns}
        getRowId={(row) => row.id}
        customRenderers={{
          'custom-bold': ({ value }) => <strong data-testid="bold-cell">{value}</strong>,
        }}
      />
    );
    const boldCells = screen.getAllByTestId('bold-cell');
    expect(boldCells.length).toBe(4);
  });

  it('renders group bar when enableGrouping is true', () => {
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        enableGrouping={true}
      />
    );
    expect(screen.getByText('Group by:')).toBeInTheDocument();
    expect(screen.getByText('Drag a column header here')).toBeInTheDocument();
  });

  it('renders many rows (200+) without error', () => {
    const manyRows: TestRow[] = Array.from({ length: 250 }, (_, i) => ({
      id: String(i),
      name: `Order ${i}`,
      status: i % 2 === 0 ? 'Open' : 'Closed',
      amount: (i + 1) * 100,
    }));
    render(
      <CommandGrid
        data={manyRows}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    expect(screen.getByText('Order 0')).toBeInTheDocument();
    expect(screen.getByText('Order 249')).toBeInTheDocument();
  });

  it('emits onColumnStateChange', () => {
    const onColumnStateChange = vi.fn();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        onColumnStateChange={onColumnStateChange}
      />
    );
    expect(onColumnStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        columnOrder: expect.any(Array),
        columnWidths: expect.any(Object),
        columnVisibility: expect.any(Object),
      })
    );
  });

  it('sets aria-sort on sorted columns', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    // Before sorting, sortable columns should have aria-sort="none"
    const nameHeader = screen.getByText('Name').closest('th');
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');

    // Click to sort ascending
    fireEvent.click(screen.getByText('Name'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    // Click again to sort descending
    fireEvent.click(screen.getByText('Name'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('sets aria-selected on selected rows', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
        selectedRowId="2"
      />
    );
    const rows = container.querySelectorAll('tr.gc-row');
    // Row with id "2" (Beta Order) should be aria-selected="true"
    const selectedRow = Array.from(rows).find((r) => r.classList.contains('gc-row--selected'));
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');

    // Other rows should be aria-selected="false"
    const unselectedRow = Array.from(rows).find((r) => !r.classList.contains('gc-row--selected'));
    expect(unselectedRow).toHaveAttribute('aria-selected', 'false');
  });

  // ── F595 Accessibility ARIA tests ──────────────────────────────

  it('sets role="columnheader" and scope="col" on th elements', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    const headers = container.querySelectorAll('th.gc-header-cell');
    headers.forEach((th) => {
      expect(th.getAttribute('role')).toBe('columnheader');
      expect(th.getAttribute('scope')).toBe('col');
    });
  });

  it('sets aria-colindex on th elements', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    const headers = container.querySelectorAll('th.gc-header-cell');
    headers.forEach((th, i) => {
      expect(th.getAttribute('aria-colindex')).toBe(String(i + 1));
    });
  });

  it('sets aria-rowindex on body tr elements', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    const rows = container.querySelectorAll('tr.gc-row');
    rows.forEach((tr) => {
      const ariRowIdx = tr.getAttribute('aria-rowindex');
      expect(ariRowIdx).toBeTruthy();
      expect(Number(ariRowIdx)).toBeGreaterThan(1); // starts at 2 (header is 1)
    });
  });

  it('sets role="gridcell" and aria-colindex on td elements', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    const firstRow = container.querySelector('tr.gc-row');
    if (firstRow) {
      const cells = firstRow.querySelectorAll('td.gc-cell');
      cells.forEach((td, i) => {
        expect(td.getAttribute('role')).toBe('gridcell');
        expect(td.getAttribute('aria-colindex')).toBe(String(i + 1));
      });
    }
  });

  it('table has role="grid"', () => {
    const { container } = render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(row) => row.id}
      />
    );
    const table = container.querySelector('table');
    expect(table?.getAttribute('role')).toBe('grid');
  });
});
