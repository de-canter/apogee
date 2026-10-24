import { describe, it, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatCsv, formatJson, downloadFile, type ExportColumn } from '../utils/export';
import { ExportMenu } from '../components/ExportMenu';

const columns: ExportColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'email', header: 'Email' },
  { id: 'age', header: 'Age' },
];

const rows = [
  { name: 'Alice', email: 'alice@example.com', age: 30 },
  { name: 'Bob', email: 'bob@example.com', age: 25 },
];

describe('formatCsv', () => {
  it('basic rows with headers', () => {
    const csv = formatCsv(rows, columns);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Name,Email,Age');
    expect(lines[1]).toBe('Alice,alice@example.com,30');
    expect(lines[2]).toBe('Bob,bob@example.com,25');
  });

  it('quotes values with commas', () => {
    const data = [{ name: 'Doe, Jane', email: 'jane@test.com', age: 28 }];
    const csv = formatCsv(data, columns);
    expect(csv).toContain('"Doe, Jane"');
  });

  it('escapes double quotes', () => {
    const data = [{ name: 'He said "hello"', email: 'x@x.com', age: 20 }];
    const csv = formatCsv(data, columns);
    expect(csv).toContain('"He said ""hello"""');
  });

  it('handles null/undefined', () => {
    const data = [{ name: null, email: undefined, age: 0 }];
    const csv = formatCsv(data as any, columns);
    const lines = csv.split('\n');
    expect(lines[1]).toBe(',,0');
  });

  it('uses custom accessor', () => {
    const cols: ExportColumn[] = [
      { id: 'name', header: 'Full Name', accessor: (r) => r.name.toUpperCase() },
    ];
    const csv = formatCsv(rows, cols);
    expect(csv).toContain('ALICE');
  });
});

describe('formatJson', () => {
  it('outputs pretty JSON array', () => {
    const json = formatJson(rows, columns);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ Name: 'Alice', Email: 'alice@example.com', Age: 30 });
  });

  it('uses column headers as keys', () => {
    const json = formatJson(rows, columns);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed[0])).toEqual(['Name', 'Email', 'Age']);
  });
});

describe('downloadFile', () => {
  it('creates blob and triggers download', () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el);
    const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el);

    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

    const clickFn = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      set href(v: string) { /* noop */ },
      set download(v: string) { /* noop */ },
      style: {},
      click: clickFn,
    } as any);

    downloadFile('test content', 'test.csv', 'text/csv');

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickFn).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');

    appendChild.mockRestore();
    removeChild.mockRestore();
    vi.restoreAllMocks();
  });
});

describe('ExportMenu', () => {
  it('renders dropdown with CSV/JSON options', () => {
    render(
      <ExportMenu
        filteredRows={rows}
        selectedRows={[]}
        columns={columns}
        title="Test Grid"
      />
    );
    // Open dropdown
    fireEvent.click(screen.getByTitle('Export data'));
    expect(screen.getByText(`Export CSV (${rows.length})`)).toBeInTheDocument();
    expect(screen.getByText(`Export JSON (${rows.length})`)).toBeInTheDocument();
  });

  it('shows selected export options when selection exists', () => {
    render(
      <ExportMenu
        filteredRows={rows}
        selectedRows={[rows[0]]}
        columns={columns}
        title="Test Grid"
      />
    );
    fireEvent.click(screen.getByTitle('Export data'));
    expect(screen.getByText('Export selected CSV (1)')).toBeInTheDocument();
    expect(screen.getByText('Export selected JSON (1)')).toBeInTheDocument();
  });
});
