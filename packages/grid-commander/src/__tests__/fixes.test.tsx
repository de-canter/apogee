import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createRef } from 'react';
import { CommandCockpit } from '../components/CommandCockpit';
import { DateEditor } from '../components/editors/DateEditor';
import { filterFns } from '../utils/filters';
import { formatCsv } from '../utils/export';
import { validateColumnDefs } from '../utils/validation';
import type { CommandColumnDef } from '../types/column';
import type { CockpitRef } from '../types/cockpit-ref';

interface Row { id: string; name: string; n: number; when: string; kind: string }
const rows: Row[] = [
  { id: '1', name: 'alpha', n: 9, when: '2030-01-02', kind: 'a' },
  { id: '2', name: 'beta', n: 10, when: '2030-01-04', kind: 'b' },
  { id: '3', name: 'gamma', n: 11, when: '2030-01-06', kind: 'a' },
  { id: '4', name: 'delta', n: 12, when: '2030-01-08', kind: 'c' },
  { id: '5', name: 'alphabet', n: 13, when: '2030-01-10', kind: 'b' },
];
const columns: CommandColumnDef<Row>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name', filterType: 'text' },
  { id: 'n', accessorKey: 'n', header: 'N', filterType: 'number-range' },
  { id: 'when', accessorKey: 'when', header: 'When', filterType: 'date-range' },
  { id: 'kind', accessorKey: 'kind', header: 'Kind', filterType: 'select', filterOptions: ['a', 'b', 'c'] },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('default filter functions', () => {
  const fake = (value: unknown) => ({ getValue: () => value }) as never;
  it('number-range with one bound keeps the open side', () => {
    expect(filterFns.numberRange(fake(10), 'n', { min: 10 }, () => undefined)).toBe(true);
    expect(filterFns.numberRange(fake(11), 'n', { min: 10 }, () => undefined)).toBe(true);
    expect(filterFns.numberRange(fake(9), 'n', { min: 10 }, () => undefined)).toBe(false);
    expect(filterFns.numberRange(fake(9), 'n', { max: 9 }, () => undefined)).toBe(true);
  });
  it('date-range with only `to` keeps earlier dates and drops later ones', () => {
    expect(filterFns.dateRange(fake('2030-01-04'), 'when', { to: '2030-01-05' }, () => undefined)).toBe(true);
    expect(filterFns.dateRange(fake('2030-01-06'), 'when', { to: '2030-01-05' }, () => undefined)).toBe(false);
  });
  it('select accepts a single value or a set', () => {
    expect(filterFns.select(fake('a'), 'kind', 'a', () => undefined)).toBe(true);
    expect(filterFns.select(fake('c'), 'kind', ['a', 'b'], () => undefined)).toBe(false);
    expect(filterFns.select(fake('b'), 'kind', ['a', 'b'], () => undefined)).toBe(true);
  });
  it('text filters by case-insensitive containment and boolean by equality', () => {
    expect(filterFns.text(fake('Alphabet'), 'name', 'pha', () => undefined)).toBe(true);
    expect(filterFns.text(fake('beta'), 'name', 'pha', () => undefined)).toBe(false);
    expect(filterFns.boolean(fake(true), 'ok', true, () => undefined)).toBe(true);
    expect(filterFns.boolean(fake(false), 'ok', true, () => undefined)).toBe(false);
  });
});

describe('cockpit applies the default filter functions and exports the filtered rows', () => {
  it('a number-range filter set through the ref narrows the rows and the CSV', () => {
    const ref = createRef<CockpitRef<Row>>();
    render(
      <CommandCockpit ref={ref} data={rows} columns={columns} getRowId={(r) => r.id} defaultFilters={[{ id: 'n', value: { min: 12 } }]} enableExport />
    );
    expect(ref.current!.getFilteredRows().map((r) => r.id)).toEqual(['4', '5']);
    const csv = formatCsv(ref.current!.getFilteredRows(), [{ id: 'name', header: 'Name' }]);
    expect(csv.trim().split('\n')).toHaveLength(3); // header + 2 rows
  });
  it('a text filter narrows the rows (Review Focus 3)', () => {
    const ref = createRef<CockpitRef<Row>>();
    render(<CommandCockpit ref={ref} data={rows} columns={columns} getRowId={(r) => r.id} defaultFilters={[{ id: 'name', value: 'alpha' }]} />);
    expect(ref.current!.getFilteredRows().map((r) => r.id)).toEqual(['1', '5']);
  });

  it('the header popover offers two inputs for a range filter', () => {
    render(<CommandCockpit data={rows} columns={columns} getRowId={(r) => r.id} />);
    fireEvent.click(screen.getAllByRole('button', { name: /filter n column/i })[0]!);
    expect(screen.getByLabelText(/minimum/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/maximum/i)).toBeInTheDocument();
  });
});

describe('editing and persistence', () => {
  it('stopEditing(false) leaves the value unchanged; stopEditing(true) commits the typed value', () => {
    const onCellEdit = vi.fn();
    const ref = createRef<CockpitRef<Row>>();
    const cols: CommandColumnDef<Row>[] = [{ id: 'name', accessorKey: 'name', header: 'Name', editable: true, cellEditor: 'text-input' }];
    render(<CommandCockpit ref={ref} data={rows} columns={cols} getRowId={(r) => r.id} onCellEdit={onCellEdit} />);
    act(() => ref.current!.startEditing('1', 'name'));
    fireEvent.change(screen.getByTestId('gc-editor-text-input'), { target: { value: 'changed' } });
    act(() => ref.current!.stopEditing(false));
    expect(onCellEdit).not.toHaveBeenCalled();
    act(() => ref.current!.startEditing('1', 'name'));
    fireEvent.change(screen.getByTestId('gc-editor-text-input'), { target: { value: 'kept' } });
    act(() => ref.current!.stopEditing(true));
    expect(onCellEdit).toHaveBeenCalledWith('1', 'name', 'kept', rows[0]);
  });
  it('DateEditor commits a local YYYY-MM-DD on Enter and cancels on Escape, in any zone', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<DateEditor value="2030-02-01" row={{}} config={{}} columnId="d" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByTestId<HTMLInputElement>('gc-editor-date');
    expect(input.value).toBe('2030-02-01');
    fireEvent.change(input, { target: { value: '2030-03-01' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('2030-03-01');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
  it('two cockpits with different persistence keys keep separate pinned-panel flags', () => {
    window.localStorage.clear();
    const a = createRef<CockpitRef<Row>>();
    render(<CommandCockpit ref={a} data={rows} columns={columns} getRowId={(r) => r.id} persistenceKey="board-a" detailPanel={() => <div>panel</div>} />);
    act(() => a.current!.openDetailPanel('1'));
    fireEvent.click(screen.getByRole('button', { name: /pin/i }));
    expect(window.localStorage.getItem('board-a:detailPanelPinned')).toBe('true');
    expect(window.localStorage.getItem('board-b:detailPanelPinned')).toBeNull();
  });
  it('validateColumnDefs survives an environment without process', () => {
    const saved = (globalThis as { process?: unknown }).process;
    delete (globalThis as { process?: unknown }).process;
    try {
      expect(() => validateColumnDefs([{ id: 'x', accessorKey: 'x', header: 'X' }])).not.toThrow();
    } finally {
      (globalThis as { process?: unknown }).process = saved;
    }
  });
});
