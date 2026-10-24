export interface ExportColumn {
  id: string;
  header: string;
  /** Custom value accessor — defaults to row[id] */
  accessor?: ((row: unknown) => string | number | boolean | null) | undefined;
}

function escapeCSVValue(value: unknown): string {
  if (value == null) return '';
  const str =
    typeof value === 'object' ? JSON.stringify(value) : typeof value === 'string' ? value : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getValue(row: unknown, column: ExportColumn): unknown {
  if (column.accessor) return column.accessor(row);
  return (row as Record<string, unknown> | null | undefined)?.[column.id];
}

/** Format rows as CSV string (handles quoting, escaping, nested objects) */
export function formatCsv<T>(rows: T[], columns: ExportColumn[]): string {
  const headerRow = columns.map((c) => escapeCSVValue(c.header)).join(',');
  const dataRows = rows.map((row) =>
    columns.map((col) => escapeCSVValue(getValue(row, col))).join(',')
  );
  return [headerRow, ...dataRows].join('\n');
}

/** Format rows as JSON string (pretty-printed) */
export function formatJson<T>(rows: T[], columns: ExportColumn[]): string {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col.header] = getValue(row, col);
    }
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

/** Trigger browser download of a string as a file */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
