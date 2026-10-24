import React from 'react';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  flexRender,
  type SortingState,
  type ColumnFiltersState,
  type GroupingState,
  type ExpandedState,
  type VisibilityState,
  type ColumnOrderState,
  type ColumnSizingState,
  type Row,
  type Header,
} from '@tanstack/react-table';
import type { CommandColumnDef, CellRendererRegistry } from '../types/column';
import type { ColumnStateChange } from '../types/persistence';
import type { RowColorRule } from '../types/grid-states';
import type { SelectionMode, RowSelectionState } from '../types/selection';
import type { EditingCell, CellEditorRegistry, OnCellEdit } from '../types/editing';
import { CheckboxCell } from './renderers/CheckboxCell';
import { useGridTable } from '../hooks/useGridTable';
import { useVirtualRows } from '../hooks/useVirtualRows';
import { createRendererRegistry, getRenderer } from './renderers/registry';
import { createEditorRegistry, getEditor } from './editors/registry';
import { GridSkeleton } from './GridSkeleton';
import { GridEmptyState } from './GridEmptyState';
import { useStickyColumns, type StickyColumnConfig } from '../hooks/useStickyColumns';

/**
 * HeaderFilterPopover — inline filter dropdown rendered inside column header.
 * Supports text (debounced 300ms), select, and boolean filter types.
 * Includes sort actions (A-Z / Z-A) and a clear button.
 */
function HeaderFilterPopover<T>({
  header,
  colDef,
  filterValue,
  onClose,
  filterDebounceRef,
}: {
  header: Header<T, unknown>;
  colDef: CommandColumnDef<T>;
  filterValue: unknown;
  onClose: () => void;
  filterDebounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [localText, setLocalText] = useState<string>((filterValue as string) ?? '');

  // Auto-focus text input on open
  useEffect(() => {
    if (colDef.filterType === 'text' || colDef.filterType === 'date-range' || colDef.filterType === 'number-range') {
      inputRef.current?.focus();
    }
  }, [colDef.filterType]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Close on Escape (capture phase)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);

  // Debounced text filter
  const handleTextChange = (value: string) => {
    setLocalText(value);
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(() => {
      header.column.setFilterValue(value || undefined);
    }, 300);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalText('');
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    header.column.setFilterValue(undefined);
  };

  const handleSort = (desc: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation();
    header.column.toggleSorting(desc);
    onClose();
  };

  const handleSelectOption = (value: string | undefined) => (e: React.MouseEvent) => {
    e.stopPropagation();
    header.column.setFilterValue(value);
    onClose();
  };

  const handleBooleanOption = (value: boolean | undefined) => (e: React.MouseEvent) => {
    e.stopPropagation();
    header.column.setFilterValue(value);
    onClose();
  };

  const hasActiveFilter = filterValue != null && filterValue !== '';
  const isSortable = header.column.getCanSort();

  return (
    <div
      ref={popoverRef}
      className="gc-header-filter-popover"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Sort actions */}
      {isSortable && (
        <div className="gc-header-filter-actions">
          <button className="gc-header-filter-sort-btn" onClick={handleSort(false)}>
            {'\u2191'} Sort A{'\u2192'}Z
          </button>
          <button className="gc-header-filter-sort-btn" onClick={handleSort(true)}>
            {'\u2193'} Sort Z{'\u2192'}A
          </button>
        </div>
      )}

      {/* Separator */}
      {isSortable && <div className="gc-header-filter-divider" />}

      {/* Text filter */}
      {(colDef.filterType === 'text' || colDef.filterType === 'date-range' || colDef.filterType === 'number-range') && (
        <div className="gc-header-filter-input-wrap">
          <input
            ref={inputRef}
            className="gc-header-filter-input"
            type="text"
            value={localText}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Filter..."
            aria-label={`Filter ${String(colDef.header || '')} column`}
          />
        </div>
      )}

      {/* Select filter */}
      {colDef.filterType === 'select' && (
        <div className="gc-header-filter-options">
          <div
            className={`gc-header-filter-option ${!hasActiveFilter ? 'gc-header-filter-option--selected' : ''}`}
            onClick={handleSelectOption(undefined)}
          >
            All
          </div>
          {colDef.filterOptions?.map((opt) => (
            <div
              key={opt}
              className={`gc-header-filter-option ${filterValue === opt ? 'gc-header-filter-option--selected' : ''}`}
              onClick={handleSelectOption(opt)}
            >
              {colDef.filterOptionLabels?.[opt] ?? opt}
            </div>
          ))}
        </div>
      )}

      {/* Boolean filter */}
      {colDef.filterType === 'boolean' && (
        <div className="gc-header-filter-options">
          <div
            className={`gc-header-filter-option ${filterValue == null ? 'gc-header-filter-option--selected' : ''}`}
            onClick={handleBooleanOption(undefined)}
          >
            All
          </div>
          <div
            className={`gc-header-filter-option ${filterValue === true ? 'gc-header-filter-option--selected' : ''}`}
            onClick={handleBooleanOption(true)}
          >
            Yes
          </div>
          <div
            className={`gc-header-filter-option ${filterValue === false ? 'gc-header-filter-option--selected' : ''}`}
            onClick={handleBooleanOption(false)}
          >
            No
          </div>
        </div>
      )}

      {/* Clear button */}
      {hasActiveFilter && (
        <>
          <div className="gc-header-filter-divider" />
          <button className="gc-header-filter-clear" onClick={handleClear}>
            {'\u2715'} Clear filter
          </button>
        </>
      )}
    </div>
  );
}

export interface CommandGridProps<T> {
  data: T[];
  columns: CommandColumnDef<T>[];
  getRowId: (row: T) => string;
  defaultSort?: SortingState | undefined;
  defaultFilters?: ColumnFiltersState | undefined;
  enableGrouping?: boolean | undefined;
  enableVirtualization?: boolean | undefined;
  rowDensity?: 'compact' | 'comfortable' | 'expanded' | undefined;
  onRowSelect?: ((row: T) => void) | undefined;
  onRowDoubleClick?: ((row: T) => void) | undefined;
  onRowContextMenu?: ((e: React.MouseEvent, row: T) => void) | undefined;
  selectedRowId?: string | null | undefined;
  customRenderers?: CellRendererRegistry | undefined;
  onColumnStateChange?: ((state: ColumnStateChange) => void) | undefined;
  // Controlled state from CommandCockpit
  sorting?: SortingState | undefined;
  onSortingChange?: ((sorting: SortingState) => void) | undefined;
  columnFilters?: ColumnFiltersState | undefined;
  onColumnFiltersChange?: ((filters: ColumnFiltersState) => void) | undefined;
  grouping?: GroupingState | undefined;
  onGroupingChange?: ((grouping: GroupingState) => void) | undefined;
  expanded?: ExpandedState | undefined;
  onExpandedChange?: ((expanded: ExpandedState) => void) | undefined;
  columnVisibility?: VisibilityState | undefined;
  onColumnVisibilityChange?: ((visibility: VisibilityState) => void) | undefined;
  columnOrder?: ColumnOrderState | undefined;
  onColumnOrderChange?: ((order: ColumnOrderState) => void) | undefined;
  columnSizing?: ColumnSizingState | undefined;
  onColumnSizingChange?: ((sizing: ColumnSizingState) => void) | undefined;
  // Global filter (controlled)
  globalFilter?: string | undefined;
  onGlobalFilterChange?: ((value: string) => void) | undefined;
  // Sprint 3: Row styling + loading
  rowClassName?: string | ((row: T) => string) | undefined;
  rowColorRules?: RowColorRule<T>[] | undefined;
  loading?: boolean | undefined;
  emptyState?: React.ReactNode | undefined;
  // Sprint 3: Sticky columns
  pinnedColumns?: StickyColumnConfig | undefined;
  // Sprint 3: Selection
  selectionMode?: SelectionMode | undefined;
  selectionState?: RowSelectionState | undefined;
  // Row model callback — reports visual row IDs after sort/filter
  onVisibleRowIdsChange?: ((ids: string[]) => void) | undefined;
  // Sprint 4: Inline editing
  editingCell?: EditingCell | null | undefined;
  onStartEditing?: ((rowId: string, columnId: string) => void) | undefined;
  onCellEdit?: OnCellEdit<T> | undefined;
  onStopEditing?: (() => void) | undefined;
  customEditors?: CellEditorRegistry | undefined;
  // Expandable sub-rows — render custom content below a row when expanded
  renderSubComponent?: ((row: T) => React.ReactNode | null) | undefined;
  getRowCanExpand?: ((row: T) => boolean) | undefined;
}

/** A filter value as a short tooltip string; objects (ranges) become JSON. */
function describeFilter(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function CommandGrid<T>({
  data,
  columns,
  getRowId,
  defaultSort = [],
  defaultFilters = [],
  enableGrouping = false,
  enableVirtualization = false,
  rowDensity = 'compact',
  onRowSelect,
  onRowDoubleClick,
  onRowContextMenu,
  selectedRowId = null,
  customRenderers,
  onColumnStateChange,
  // Controlled state
  sorting: controlledSorting,
  onSortingChange: controlledOnSortingChange,
  columnFilters: controlledColumnFilters,
  onColumnFiltersChange: controlledOnColumnFiltersChange,
  grouping: controlledGrouping,
  onGroupingChange: controlledOnGroupingChange,
  expanded: controlledExpanded,
  onExpandedChange: controlledOnExpandedChange,
  columnVisibility: controlledColumnVisibility,
  onColumnVisibilityChange: controlledOnColumnVisibilityChange,
  columnOrder: controlledColumnOrder,
  onColumnOrderChange: controlledOnColumnOrderChange,
  columnSizing: controlledColumnSizing,
  onColumnSizingChange: controlledOnColumnSizingChange,
  globalFilter: controlledGlobalFilter,
  onGlobalFilterChange: controlledOnGlobalFilterChange,
  // Sprint 3
  rowClassName,
  rowColorRules,
  loading = false,
  emptyState,
  pinnedColumns,
  selectionMode = 'none',
  selectionState,
  onVisibleRowIdsChange,
  // Sprint 4: Inline editing
  editingCell,
  onStartEditing,
  onCellEdit,
  onStopEditing,
  customEditors,
  renderSubComponent,
  getRowCanExpand,
}: CommandGridProps<T>) {
  // Header filter popover — which column's filter is open
  const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Internal state (used when not controlled)
  const [internalSorting, setInternalSorting] = useState<SortingState>(defaultSort);
  const [internalColumnFilters, setInternalColumnFilters] =
    useState<ColumnFiltersState>(defaultFilters);
  const [internalGrouping, setInternalGrouping] = useState<GroupingState>([]);
  const [internalExpanded, setInternalExpanded] = useState<ExpandedState>({});
  const [internalColumnVisibility, setInternalColumnVisibility] = useState<VisibilityState>({});
  const [internalColumnOrder, setInternalColumnOrder] = useState<ColumnOrderState>(
    columns.map((c) => c.id)
  );
  const [internalColumnSizing, setInternalColumnSizing] = useState<ColumnSizingState>({});

  // Use controlled or internal state
  const sorting = controlledSorting ?? internalSorting;
  const columnFilters = controlledColumnFilters ?? internalColumnFilters;
  const grouping = controlledGrouping ?? internalGrouping;
  const expanded = controlledExpanded ?? internalExpanded;
  const columnVisibility = controlledColumnVisibility ?? internalColumnVisibility;
  const columnOrder = controlledColumnOrder ?? internalColumnOrder;
  const columnSizing = controlledColumnSizing ?? internalColumnSizing;

  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      if (controlledOnSortingChange) controlledOnSortingChange(next);
      else setInternalSorting(next);
    },
    [sorting, controlledOnSortingChange]
  );

  const handleColumnFiltersChange = useCallback(
    (updater: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => {
      const next = typeof updater === 'function' ? updater(columnFilters) : updater;
      if (controlledOnColumnFiltersChange) controlledOnColumnFiltersChange(next);
      else setInternalColumnFilters(next);
    },
    [columnFilters, controlledOnColumnFiltersChange]
  );

  const handleGroupingChange = useCallback(
    (updater: GroupingState | ((prev: GroupingState) => GroupingState)) => {
      const next = typeof updater === 'function' ? updater(grouping) : updater;
      if (controlledOnGroupingChange) controlledOnGroupingChange(next);
      else setInternalGrouping(next);
    },
    [grouping, controlledOnGroupingChange]
  );

  const handleExpandedChange = useCallback(
    (updater: ExpandedState | ((prev: ExpandedState) => ExpandedState)) => {
      const next = typeof updater === 'function' ? updater(expanded) : updater;
      if (controlledOnExpandedChange) controlledOnExpandedChange(next);
      else setInternalExpanded(next);
    },
    [expanded, controlledOnExpandedChange]
  );

  const handleColumnVisibilityChange = useCallback(
    (updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
      const next = typeof updater === 'function' ? updater(columnVisibility) : updater;
      if (controlledOnColumnVisibilityChange) controlledOnColumnVisibilityChange(next);
      else setInternalColumnVisibility(next);
    },
    [columnVisibility, controlledOnColumnVisibilityChange]
  );

  const handleColumnOrderChange = useCallback(
    (updater: ColumnOrderState | ((prev: ColumnOrderState) => ColumnOrderState)) => {
      const next = typeof updater === 'function' ? updater(columnOrder) : updater;
      if (controlledOnColumnOrderChange) controlledOnColumnOrderChange(next);
      else setInternalColumnOrder(next);
    },
    [columnOrder, controlledOnColumnOrderChange]
  );

  const handleColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      const next = typeof updater === 'function' ? updater(columnSizing) : updater;
      if (controlledOnColumnSizingChange) controlledOnColumnSizingChange(next);
      else setInternalColumnSizing(next);
    },
    [columnSizing, controlledOnColumnSizingChange]
  );

  // Emit column state changes
  useEffect(() => {
    onColumnStateChange?.({
      columnOrder,
      columnWidths: columnSizing,
      columnVisibility,
    });
  }, [columnOrder, columnSizing, columnVisibility, onColumnStateChange]);

  // Renderer registry
  const rendererRegistry = useMemo(
    () => createRendererRegistry(customRenderers),
    [customRenderers]
  );

  // Editor registry
  const editorRegistry = useMemo(
    () => createEditorRegistry(customEditors),
    [customEditors]
  );

  // Sticky columns
  const { getColumnStyle: getStickyStyle, getColumnClass: getStickyClass, hasStickyColumns } =
    useStickyColumns(pinnedColumns, columns, columnSizing);

  const table = useGridTable({
    data,
    columns,
    getRowId,
    sorting,
    onSortingChange: handleSortingChange,
    columnFilters,
    onColumnFiltersChange: handleColumnFiltersChange,
    grouping,
    onGroupingChange: handleGroupingChange,
    expanded,
    onExpandedChange: handleExpandedChange,
    columnVisibility,
    onColumnVisibilityChange: handleColumnVisibilityChange,
    columnOrder,
    onColumnOrderChange: handleColumnOrderChange,
    columnSizing,
    onColumnSizingChange: handleColumnSizingChange,
    enableGrouping,
    globalFilter: controlledGlobalFilter,
    onGlobalFilterChange: controlledOnGlobalFilterChange,
    getRowCanExpand,
  });

  const rows = table.getRowModel().rows;

  // Report visual row order to parent for keyboard navigation
  useEffect(() => {
    onVisibleRowIdsChange?.(rows.map((r) => r.id));
  }, [rows, onVisibleRowIdsChange]);

  // Virtual scrolling
  const { parentRef, virtualItems, totalSize } = useVirtualRows({
    rowCount: rows.length,
    rowDensity,
    enabled: enableVirtualization,
  });

  // Scroll selected row into view when selection changes programmatically
  const scrollTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedRowId || selectedRowId === scrollTargetRef.current) return;
    scrollTargetRef.current = selectedRowId;
    // Defer to allow the DOM to update with the new gc-row--selected class
    requestAnimationFrame(() => {
      const container = (parentRef?.current ?? document.querySelector('.gc-grid'));
      if (!container) return;
      const rowEl = container.querySelector<HTMLElement>('tr.gc-row--selected');
      if (rowEl) {
        rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }, [selectedRowId, parentRef]);

  // Column DnD state
  const [dragColumnId, setDragColumnId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  // Group bar DnD
  const [groupBarDragOver, setGroupBarDragOver] = useState(false);

  // Grid ref for keyboard scope detection
  const gridRef = useRef<HTMLDivElement>(null);

  // Header drag handlers
  const handleHeaderDragStart = useCallback(
    (e: React.DragEvent, headerId: string) => {
      setDragColumnId(headerId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', headerId);
    },
    []
  );

  const handleHeaderDragOver = useCallback(
    (e: React.DragEvent, headerId: string) => {
      e.preventDefault();
      setDragOverColumnId(headerId);
    },
    []
  );

  const handleHeaderDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData('text/plain');
      if (sourceId && sourceId !== targetId) {
        const newOrder = [...columnOrder];
        const sourceIdx = newOrder.indexOf(sourceId);
        const targetIdx = newOrder.indexOf(targetId);
        if (sourceIdx !== -1 && targetIdx !== -1) {
          newOrder.splice(sourceIdx, 1);
          newOrder.splice(targetIdx, 0, sourceId);
          handleColumnOrderChange(newOrder);
        }
      }
      setDragColumnId(null);
      setDragOverColumnId(null);
    },
    [columnOrder, handleColumnOrderChange]
  );

  const handleHeaderDragEnd = useCallback(() => {
    setDragColumnId(null);
    setDragOverColumnId(null);
  }, []);

  // Group bar handlers
  const handleGroupBarDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setGroupBarDragOver(true);
  }, []);

  const handleGroupBarDragLeave = useCallback(() => {
    setGroupBarDragOver(false);
  }, []);

  const handleGroupBarDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setGroupBarDragOver(false);
      const columnId = e.dataTransfer.getData('text/plain');
      if (columnId && !grouping.includes(columnId)) {
        handleGroupingChange([...grouping, columnId]);
      }
    },
    [grouping, handleGroupingChange]
  );

  const removeGroupColumn = useCallback(
    (columnId: string) => {
      handleGroupingChange(grouping.filter((g) => g !== columnId));
    },
    [grouping, handleGroupingChange]
  );

  const toggleExpandAll = useCallback(() => {
    const allExpanded = Object.keys(expanded).length > 0;
    handleExpandedChange(allExpanded ? {} : true);
  }, [expanded, handleExpandedChange]);

  // Get column def lookup for renderer config
  const columnDefMap = useMemo(() => {
    const map = new Map<string, CommandColumnDef<T>>();
    for (const col of columns) {
      map.set(col.id, col);
    }
    return map;
  }, [columns]);


  // Render cell via registry
  const renderCell = useCallback(
    (row: Row<T>, columnId: string, value: unknown) => {
      const colDef = columnDefMap.get(columnId);
      const rendererName = colDef?.cellRenderer;
      const renderer = getRenderer(rendererRegistry, rendererName);
      return renderer({
        value,
        row: row.original,
        config: colDef?.cellConfig || {},
        columnId,
      });
    },
    [columnDefMap, rendererRegistry]
  );

  // Render editor for a cell
  const renderEditor = useCallback(
    (row: Row<T>, columnId: string, value: unknown) => {
      const colDef = columnDefMap.get(columnId);
      const editorName = colDef?.cellEditor;
      const editor = getEditor(editorRegistry, editorName);
      if (!editor) return renderCell(row, columnId, value);
      // Editors are function components with their own hooks; mount them as elements
      // (calling them inline would run their hooks as CommandGrid's and throw
      // "Rendered more hooks than during the previous render").
      return React.createElement(editor as React.FC<Parameters<typeof editor>[0]>, {
        key: `${row.id}:${columnId}`,
        value,
        row: row.original,
        config: { ...colDef?.cellConfig, ...colDef?.cellEditorConfig },
        columnId,
        onCommit: (newValue: unknown) => {
          onCellEdit?.(row.id, columnId, newValue, row.original);
          onStopEditing?.();
        },
        onCancel: () => {
          onStopEditing?.();
        },
      });
    },
    [columnDefMap, editorRegistry, renderCell, onCellEdit, onStopEditing]
  );

  const densityClass = `gc-density-${rowDensity}`;

  // Build row rendering
  const renderRow = useCallback(
    (row: Row<T>, index: number, style?: React.CSSProperties) => {
      const isSelected = row.id === selectedRowId;
      const isMultiSelected = selectionState?.isSelected(row.id) ?? false;
      const isAlt = index % 2 === 1;

      if (row.getIsGrouped()) {
        return (
          <tr
            key={row.id}
            className="gc-group-header-row"
            style={style}
          >
            <td
              className="gc-group-header-cell"
              colSpan={table.getVisibleLeafColumns().length}
            >
              <span
                className={`gc-group-chevron ${row.getIsExpanded() ? 'gc-group-chevron--expanded' : ''}`}
                onClick={() => row.toggleExpanded()}
              >
                {'\u25B6'}
              </span>
              {' '}
              {row.groupingColumnId}: {String(row.groupingValue)}
              <span className="gc-group-count">({row.subRows.length})</span>
            </td>
          </tr>
        );
      }

      // Compute row className from prop
      const customClassName =
        typeof rowClassName === 'function'
          ? rowClassName(row.original)
          : rowClassName;

      // Find first matching color rule
      const matchedRule = rowColorRules?.find((rule) => rule.match(row.original));

      return (
        <React.Fragment key={row.id}>
        <tr
          key={row.id}
          className={[
            'gc-row',
            isAlt && 'gc-row--alt',
            isSelected && 'gc-row--selected',
            isMultiSelected && 'gc-row--multi-selected',
            customClassName,
            matchedRule?.className,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-selected={isSelected}
          aria-rowindex={index + 2}
          data-row-id={row.id}
          style={{ ...style, ...(isSelected || isMultiSelected ? undefined : matchedRule?.style) }}
          onClick={() => onRowSelect?.(row.original)}
          onDoubleClick={() => onRowDoubleClick?.(row.original)}
          onContextMenu={
            onRowContextMenu
              ? (e) => {
                  e.preventDefault();
                  onRowContextMenu(e, row.original);
                }
              : undefined
          }
        >
          {selectionMode === 'multi' && selectionState && (
            <td className="gc-cell gc-cell--checkbox" style={{ width: 36 }}>
              <CheckboxCell
                value={null}
                row={row.original}
                columnId="__selection"
                config={{
                  isSelected: isMultiSelected,
                  onToggle: () => selectionState.toggleRow(row.id),
                }}
              />
            </td>
          )}
          {renderSubComponent && (
            <td className="gc-cell gc-cell--expand" style={{ width: 24, padding: 0, textAlign: 'center', cursor: row.getCanExpand() ? 'pointer' : 'default' }}>
              {row.getCanExpand() ? (
                <span
                  onClick={(e) => { e.stopPropagation(); row.toggleExpanded(); }}
                  className={`gc-expand-chevron ${row.getIsExpanded() ? 'gc-expand-chevron--expanded' : ''}`}
                  style={{ display: 'inline-block', fontSize: 10, color: 'var(--gc-text-dim, #94a3b8)', transition: 'transform 0.15s', transform: row.getIsExpanded() ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >
                  {'\u25B6'}
                </span>
              ) : null}
            </td>
          )}
          {row.getVisibleCells().map((cell, cellIdx) => {
            const colDef = columnDefMap.get(cell.column.id);
            const align = colDef?.align;
            const cellStickyStyle = getStickyStyle(cell.column.id);
            const cellStickyClass = getStickyClass(cell.column.id);
            const isEditing =
              editingCell?.rowId === row.id && editingCell?.columnId === cell.column.id;
            const isEditable = colDef?.editable === true;
            return (
              <td
                key={cell.id}
                role="gridcell"
                aria-colindex={cellIdx + 1}
                className={[
                  'gc-cell',
                  align === 'center' && 'gc-cell--align-center',
                  align === 'right' && 'gc-cell--align-right',
                  isEditing && 'gc-cell--editing',
                  cellStickyClass,
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  width: cell.column.getSize(),
                  ...colDef?.cellStyle,
                  ...cellStickyStyle,
                }}
                onDoubleClick={
                  isEditable && onStartEditing
                    ? (e) => {
                        e.stopPropagation();
                        onStartEditing(row.id, cell.column.id);
                      }
                    : undefined
                }
              >
                {isEditing
                  ? renderEditor(row, cell.column.id, cell.getValue())
                  : cell.getIsGrouped()
                    ? flexRender(cell.column.columnDef.cell, cell.getContext())
                    : cell.getIsAggregated()
                      ? flexRender(cell.column.columnDef.aggregatedCell, cell.getContext())
                      : renderCell(row, cell.column.id, cell.getValue())}
              </td>
            );
          })}
        </tr>
        {renderSubComponent && row.getIsExpanded() && (
          <tr key={`${row.id}-sub`} className="gc-sub-row">
            <td
              colSpan={table.getVisibleLeafColumns().length + (selectionMode === 'multi' ? 1 : 0) + (renderSubComponent != null ? 1 : 0)}
              className="gc-sub-row-cell"
              style={{ padding: 0 }}
            >
              {renderSubComponent(row.original)}
            </td>
          </tr>
        )}
        </React.Fragment>
      );
    },
    [selectedRowId, table, columnDefMap, renderCell, renderEditor, onRowSelect, onRowDoubleClick, onRowContextMenu, rowClassName, rowColorRules, selectionMode, selectionState, editingCell, onStartEditing, renderSubComponent]
  );

  return (
    <div
      className={`gc-grid ${densityClass}`}
      ref={enableVirtualization ? parentRef : gridRef}
      aria-rowcount={rows.length}
      aria-colcount={table.getVisibleLeafColumns().length}
    >
      {/* Group Bar */}
      {enableGrouping && (
        <div
          className={`gc-group-bar ${groupBarDragOver ? 'gc-group-bar--drag-over' : ''}`}
          onDragOver={handleGroupBarDragOver}
          onDragLeave={handleGroupBarDragLeave}
          onDrop={handleGroupBarDrop}
        >
          <span className="gc-group-bar-label">Group by:</span>
          {grouping.length === 0 && (
            <span style={{ color: 'var(--gc-text-dim)', fontSize: 11 }}>
              Drag a column header here
            </span>
          )}
          {grouping.map((colId) => {
            const col = columnDefMap.get(colId);
            return (
              <span key={colId} className="gc-group-chip">
                {(col?.header as string) || colId}
                <span
                  className="gc-group-chip-remove"
                  onClick={() => removeGroupColumn(colId)}
                >
                  {'\u2715'}
                </span>
              </span>
            );
          })}
          {grouping.length > 0 && (
            <div className="gc-group-actions">
              <button className="gc-group-toggle" onClick={toggleExpandAll}>
                {Object.keys(expanded).length > 0 ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          )}
        </div>
      )}

      {loading && (
        <GridSkeleton
          rows={8}
          columns={columns.length || 5}
          density={rowDensity}
        />
      )}

      {!loading && (
      <table role="grid" className={`gc-table ${hasStickyColumns ? 'gc-table--sticky' : ''}`}>
        <thead>
          {/* Header Row */}
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="gc-header-row">
              {selectionMode === 'multi' && selectionState && (
                <th className="gc-header-cell gc-header-cell--checkbox" style={{ width: 36 }}>
                  <CheckboxCell
                    value={null}
                    row={{}}
                    columnId="__selection"
                    config={{
                      isHeader: true,
                      isAllSelected: selectionState.isAllSelected,
                      isPartiallySelected: selectionState.isPartiallySelected,
                      onToggleAll: selectionState.toggleAll,
                    }}
                  />
                </th>
              )}
              {renderSubComponent && (
                <th className="gc-header-cell gc-header-cell--expand" style={{ width: 24 }} />
              )}
              {headerGroup.headers.map((header, colIdx) => {
                const colDef = columnDefMap.get(header.column.id);
                const isSortable = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                const align = colDef?.align;
                const hasFilter = !!colDef?.filterType;
                const filterValue = header.column.getFilterValue();
                const isFilterActive = filterValue != null && filterValue !== '';
                const isFilterOpen = activeFilterColumn === header.column.id;

                const stickyStyle = getStickyStyle(header.column.id);
                const stickyClass = getStickyClass(header.column.id);

                return (
                  <th
                    key={header.id}
                    role="columnheader"
                    scope="col"
                    aria-colindex={colIdx + 1}
                    className={[
                      'gc-header-cell',
                      isSortable && 'gc-header-cell--sortable',
                      align === 'center' && 'gc-header-cell--align-center',
                      align === 'right' && 'gc-header-cell--align-right',
                      dragColumnId === header.column.id && 'gc-header-cell--dragging',
                      dragOverColumnId === header.column.id && 'gc-header-cell--drag-over',
                      stickyClass,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ width: header.getSize(), ...stickyStyle }}
                    aria-sort={isSortable ? (sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none') : undefined}
                    onClick={isSortable ? header.column.getToggleSortingHandler() : undefined}
                    draggable
                    onDragStart={(e) => handleHeaderDragStart(e, header.column.id)}
                    onDragOver={(e) => handleHeaderDragOver(e, header.column.id)}
                    onDrop={(e) => handleHeaderDrop(e, header.column.id)}
                    onDragEnd={handleHeaderDragEnd}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {sortDir && (
                      <span className="gc-sort-indicator">
                        {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
                      </span>
                    )}
                    {/* Filter funnel icon */}
                    {hasFilter && (
                      <button
                        className={`gc-header-filter-btn ${isFilterActive ? 'gc-header-filter-btn--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFilterColumn(isFilterOpen ? null : header.column.id);
                        }}
                        aria-label={`Filter ${String(colDef?.header || '')} column`}
                        title={isFilterActive ? `Filtered: ${describeFilter(filterValue)}` : 'Filter'}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                          <path d="M0 1h10L6.5 5.5V9L3.5 10V5.5L0 1z" />
                        </svg>
                      </button>
                    )}
                    {/* Header Filter Popover */}
                    {hasFilter && isFilterOpen && (
                      <HeaderFilterPopover
                        header={header}
                        colDef={colDef}
                        filterValue={filterValue}
                        onClose={() => setActiveFilterColumn(null)}
                        filterDebounceRef={filterDebounceRef}
                      />
                    )}
                    {/* Resize Handle */}
                    <div
                      className={`gc-resize-handle ${
                        header.column.getIsResizing() ? 'gc-resize-handle--active' : ''
                      }`}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}
              {/* Pin header column removed */}
            </tr>
          ))}

          {/* Filter row removed — filters are now inline in column header popovers */}
        </thead>

        <tbody>
          {enableVirtualization ? (
            <>
              {/* Spacer for virtual scroll */}
              {virtualItems.length > 0 && virtualItems[0]!.start > 0 && (
                <tr>
                  <td style={{ height: virtualItems[0]!.start, padding: 0 }} />
                </tr>
              )}
              {virtualItems.map((virtualItem) => {
                const row = rows[virtualItem.index];
                if (!row) return null;
                return renderRow(row, virtualItem.index);
              })}
              {virtualItems.length > 0 && (
                <tr>
                  <td
                    style={{
                      height: totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0),
                      padding: 0,
                    }}
                  />
                </tr>
              )}
            </>
          ) : (
            rows.map((row, index) => renderRow(row, index))
          )}
        </tbody>
      </table>
      )}

      {!loading && rows.length === 0 && (
        emptyState ?? <GridEmptyState />
      )}
    </div>
  );
}
