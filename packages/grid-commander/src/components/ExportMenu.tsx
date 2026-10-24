import { useState, useCallback, useRef, useEffect } from 'react';
import { formatCsv, formatJson, downloadFile, type ExportColumn } from '../utils/export';

interface ExportMenuProps<T = unknown> {
  /** All filtered rows */
  filteredRows: T[];
  /** Selected rows (for export-selected) */
  selectedRows: T[];
  /** Column definitions for export */
  columns: ExportColumn[];
  /** Grid title for filename */
  title?: string | undefined;
}

function getTimestamp(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
}

export function ExportMenu<T>({
  filteredRows,
  selectedRows,
  columns,
  title = 'export',
}: ExportMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const slugTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const hasSelection = selectedRows.length > 0;

  const handleExport = useCallback(
    (format: 'csv' | 'json', scope: 'all' | 'selected') => {
      const rows = scope === 'selected' ? selectedRows : filteredRows;
      const timestamp = getTimestamp();
      if (format === 'csv') {
        const content = formatCsv(rows, columns);
        downloadFile(content, `${slugTitle}_${timestamp}.csv`, 'text/csv;charset=utf-8');
      } else {
        const content = formatJson(rows, columns);
        downloadFile(content, `${slugTitle}_${timestamp}.json`, 'application/json');
      }
      setOpen(false);
    },
    [filteredRows, selectedRows, columns, slugTitle]
  );

  return (
    <div className="gc-export-wrapper" ref={menuRef}>
      <button
        className="gc-toolbar-btn"
        onClick={() => setOpen(!open)}
        title="Export data"
      >
        {'\u2913'}
      </button>
      {open && (
        <div className="gc-export-menu">
          <button
            className="gc-export-menu-item"
            onClick={() => handleExport('csv', 'all')}
          >
            Export CSV ({filteredRows.length})
          </button>
          <button
            className="gc-export-menu-item"
            onClick={() => handleExport('json', 'all')}
          >
            Export JSON ({filteredRows.length})
          </button>
          {hasSelection && (
            <>
              <div className="gc-export-menu-divider" />
              <button
                className="gc-export-menu-item"
                onClick={() => handleExport('csv', 'selected')}
              >
                Export selected CSV ({selectedRows.length})
              </button>
              <button
                className="gc-export-menu-item"
                onClick={() => handleExport('json', 'selected')}
              >
                Export selected JSON ({selectedRows.length})
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
