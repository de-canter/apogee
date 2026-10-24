import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandGrid } from '../components/CommandGrid';
import type { CommandColumnDef } from '../types/column';

interface TestRow {
  id: string;
  name: string;
  status: string;
  date: string;
}

const testData: TestRow[] = [
  { id: '1', name: 'Alpha', status: 'Open', date: '2024-01-01' },
  { id: '2', name: 'Beta', status: 'Closed', date: '2024-02-01' },
];

const testColumns: CommandColumnDef<TestRow>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Name',
    size: 200,
    editable: true,
    cellEditor: 'text-input',
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Status',
    size: 100,
    editable: true,
    cellEditor: 'select',
    cellEditorConfig: {
      options: [
        { value: 'Open', label: 'Open' },
        { value: 'Closed', label: 'Closed' },
      ],
    },
  },
  {
    id: 'date',
    accessorKey: 'date',
    header: 'Date',
    size: 100,
    editable: false,
  },
];

describe('Inline Editing in CommandGrid', () => {
  it('fires onStartEditing on double-click of editable cell', () => {
    const onStartEditing = vi.fn();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        onStartEditing={onStartEditing}
      />
    );
    // Get all cells — find the first data cell (not header)
    const cells = screen.getAllByRole('gridcell');
    // First cell of first data row should be "Alpha" (editable name)
    const editableCell = cells.find((c) => c.textContent === 'Alpha');
    expect(editableCell).toBeDefined();
    fireEvent.doubleClick(editableCell!);
    expect(onStartEditing).toHaveBeenCalledWith('1', 'name');
  });

  it('renders text editor when editingCell matches', () => {
    const onCellEdit = vi.fn();
    const onStopEditing = vi.fn();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        editingCell={{ rowId: '1', columnId: 'name' }}
        onCellEdit={onCellEdit}
        onStopEditing={onStopEditing}
      />
    );
    const input = screen.getByTestId('gc-editor-text-input');
    expect(input).toBeDefined();
    expect((input as HTMLInputElement).value).toBe('Alpha');
  });

  it('commits edit on Enter and calls onCellEdit', () => {
    const onCellEdit = vi.fn();
    const onStopEditing = vi.fn();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        editingCell={{ rowId: '1', columnId: 'name' }}
        onCellEdit={onCellEdit}
        onStopEditing={onStopEditing}
      />
    );
    const input = screen.getByTestId('gc-editor-text-input');
    fireEvent.change(input, { target: { value: 'Updated' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCellEdit).toHaveBeenCalledWith('1', 'name', 'Updated', testData[0]);
    expect(onStopEditing).toHaveBeenCalled();
  });

  it('cancels edit on Escape', () => {
    const onCellEdit = vi.fn();
    const onStopEditing = vi.fn();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        editingCell={{ rowId: '1', columnId: 'name' }}
        onCellEdit={onCellEdit}
        onStopEditing={onStopEditing}
      />
    );
    const input = screen.getByTestId('gc-editor-text-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCellEdit).not.toHaveBeenCalled();
    expect(onStopEditing).toHaveBeenCalled();
  });

  it('does not fire onStartEditing for non-editable cells', () => {
    const onStartEditing = vi.fn();
    render(
      <CommandGrid
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        onStartEditing={onStartEditing}
      />
    );
    // Date column is not editable
    const cells = screen.getAllByRole('gridcell');
    const nonEditableCell = cells.find((c) => c.textContent === '2024-01-01');
    expect(nonEditableCell).toBeDefined();
    fireEvent.doubleClick(nonEditableCell!);
    expect(onStartEditing).not.toHaveBeenCalled();
  });
});
