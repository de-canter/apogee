import { useState, useCallback, useRef, useEffect } from 'react';
import type { VisibilityState } from '@tanstack/react-table';
import type { FilterPreset, PrimaryAction, ToolbarActionButton } from '../types/toolbar';
import type { CommandColumnDef } from '../types/column';
import type { ExportColumn } from '../utils/export';
import { ExportMenu } from './ExportMenu';

export interface CommandToolbarProps<T = unknown> {
  title?: string | undefined;
  rowCount: number;
  filteredRowCount: number;
  /** Hide the row count next to the title (a grid whose rows are not the thing being counted). */
  showRowCount?: boolean | undefined;

  // Global filter
  enableGlobalFilter?: boolean | undefined;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  globalFilterRef?: React.RefObject<HTMLInputElement | null> | undefined;

  // Presets
  presets?: FilterPreset[] | undefined;
  activePresetId?: string | null | undefined;
  onPresetChange?: ((preset: FilterPreset) => void) | undefined;

  // Density
  rowDensity: 'compact' | 'comfortable' | 'expanded';
  onCycleDensity: () => void;

  // Column config
  columns: CommandColumnDef<T>[];
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (vis: VisibilityState) => void;

  // Action buttons (between presets and search)
  actionButtons?: ToolbarActionButton[] | undefined;

  // Primary action
  primaryAction?: PrimaryAction | undefined;

  // Sprint 3: Export
  enableExport?: boolean | undefined;
  exportColumns?: ExportColumn[] | undefined;
  filteredRows?: T[] | undefined;
  selectedRows?: T[] | undefined;
}

const DENSITY_ICONS: Record<string, string> = {
  compact: '\u2630',     // ☰ hamburger
  comfortable: '\u2261', // ≡ triple bar
  expanded: '\u2263',    // ≣ quadruple bar (fallback)
};

export function CommandToolbar<T>({
  title,
  rowCount,
  filteredRowCount,
  showRowCount = true,
  enableGlobalFilter = true,
  globalFilter,
  onGlobalFilterChange,
  globalFilterRef,
  presets = [],
  activePresetId,
  onPresetChange,
  rowDensity,
  onCycleDensity,
  columns,
  columnVisibility,
  onColumnVisibilityChange,
  actionButtons = [],
  primaryAction,
  enableExport = false,
  exportColumns,
  filteredRows = [],
  selectedRows = [],
}: CommandToolbarProps<T>) {
  const [columnConfigOpen, setColumnConfigOpen] = useState(false);
  const columnConfigRef = useRef<HTMLDivElement>(null);
  const [filterInput, setFilterInput] = useState(globalFilter);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sync external changes
  useEffect(() => {
    setFilterInput(globalFilter);
  }, [globalFilter]);

  // Debounced global filter
  const handleFilterChange = useCallback(
    (value: string) => {
      setFilterInput(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onGlobalFilterChange(value);
      }, 300);
    },
    [onGlobalFilterChange]
  );

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Close column config on outside click or Escape
  useEffect(() => {
    if (!columnConfigOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (columnConfigRef.current && !columnConfigRef.current.contains(e.target as Node)) {
        setColumnConfigOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        setColumnConfigOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [columnConfigOpen]);

  const isFiltered = filteredRowCount < rowCount;
  const countLabel = isFiltered
    ? `${filteredRowCount} of ${rowCount}`
    : `${rowCount}`;

  const handleToggleColumn = useCallback(
    (colId: string) => {
      const current = columnVisibility[colId] ?? true;
      onColumnVisibilityChange({ ...columnVisibility, [colId]: !current });
    },
    [columnVisibility, onColumnVisibilityChange]
  );

  const handleResetColumns = useCallback(() => {
    onColumnVisibilityChange({});
  }, [onColumnVisibilityChange]);

  return (
    <div className="gc-toolbar">
      {/* Title + count */}
      <div className="gc-toolbar-title">
        {title && <span className="gc-toolbar-title-text">{title}</span>}
        {showRowCount && <span className="gc-toolbar-count">{countLabel}</span>}
      </div>

      {/* Presets */}
      {presets.length > 0 && (
        <div className="gc-toolbar-presets">
          {presets.map((preset) => (
            <button
              key={preset.id}
              className={`gc-toolbar-preset ${activePresetId === preset.id ? 'gc-toolbar-preset--active' : ''}`}
              onClick={() => onPresetChange?.(preset)}
            >
              {preset.icon && <span className="gc-toolbar-preset-icon">{preset.icon}</span>}
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {actionButtons.length > 0 && (
        <div className="gc-toolbar-actions">
          {actionButtons.map((btn) => (
            <button
              key={btn.id}
              ref={btn.buttonRef}
              data-action-id={btn.id}
              data-testid={btn.testId}
              className="gc-toolbar-action"
              onClick={btn.onClick}
              disabled={btn.disabled}
              title={btn.title ?? (btn.shortcut ? `${btn.label} (${btn.shortcut})` : btn.label)}
              style={btn.accentColor ? { borderLeftColor: btn.accentColor } : undefined}
            >
              {btn.icon && <span className="gc-toolbar-action-icon" style={btn.accentColor ? { color: btn.accentColor } : undefined}>{btn.icon}</span>}
              <span className="gc-toolbar-action-label">{btn.label}</span>
              {btn.shortcut && <span className="gc-toolbar-action-shortcut">{btn.shortcut}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Spacer */}
      <div className="gc-toolbar-spacer" />

      {/* Global filter */}
      {enableGlobalFilter && (
        <div className="gc-toolbar-search">
          <span className="gc-toolbar-search-icon">{'\u2315'}</span>
          <input
            ref={globalFilterRef}
            className="gc-toolbar-search-input"
            type="text"
            value={filterInput}
            onChange={(e) => handleFilterChange(e.target.value)}
            placeholder="Search..."
          />
          {filterInput && (
            <button
              className="gc-toolbar-search-clear"
              onClick={() => handleFilterChange('')}
            >
              {'\u2715'}
            </button>
          )}
        </div>
      )}

      {/* Density toggle */}
      <button
        className="gc-toolbar-btn"
        onClick={onCycleDensity}
        title={`Row density: ${rowDensity}`}
      >
        {DENSITY_ICONS[rowDensity] || '\u2630'}
      </button>

      {/* Column config */}
      <div className="gc-toolbar-colconfig-wrapper" ref={columnConfigRef}>
        <button
          className="gc-toolbar-btn"
          onClick={() => setColumnConfigOpen(!columnConfigOpen)}
          title="Configure columns"
        >
          {'\u2699'}
        </button>
        {columnConfigOpen && (
          <div className="gc-toolbar-colconfig">
            <div className="gc-toolbar-colconfig-header">
              <span>Columns</span>
              <button
                className="gc-toolbar-colconfig-reset"
                onClick={handleResetColumns}
              >
                Reset
              </button>
            </div>
            {columns.map((col) => {
              const visible = columnVisibility[col.id] ?? true;
              return (
                <label key={col.id} className="gc-toolbar-colconfig-item">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => handleToggleColumn(col.id)}
                  />
                  <span>{(col.header as string) || col.id}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Export */}
      {enableExport && exportColumns && (
        <ExportMenu
          filteredRows={filteredRows}
          selectedRows={selectedRows}
          columns={exportColumns}
          title={title}
        />
      )}

      {/* Primary action */}
      {primaryAction && (
        <button
          className="gc-toolbar-primary"
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
        >
          {primaryAction.icon && <span>{primaryAction.icon}</span>}
          {primaryAction.label}
        </button>
      )}
    </div>
  );
}
