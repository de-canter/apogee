import { useState, useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  type SortingState,
  type ColumnFiltersState,
  type GroupingState,
  type ExpandedState,
  type VisibilityState,
  type ColumnOrderState,
  type ColumnSizingState,
} from '@tanstack/react-table';
import { ThemeProvider } from '../themes/ThemeProvider';
import { CommandGrid } from './CommandGrid';
import { CommandToolbar } from './CommandToolbar';
import { CommandStatusBar } from './CommandStatusBar';
import { CommandDetailPanel } from './CommandDetailPanel';
import { CommandContextMenu, type ContextMenuState } from './CommandContextMenu';
import { usePersistedState } from '../hooks/usePersistedState';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { ThemeConfig, ThemeOverrides } from '../types/theme';
import type { PersistedGridState } from '../types/persistence';
import type { CommandColumnDef, CellRendererRegistry } from '../types/column';
import type { CommandActionItem } from '../types/actions';
import type { CommandShortcut } from '../types/shortcuts';
import type { CommandStatusItem } from '../types/status-bar';
import type { FilterPreset, PrimaryAction, ToolbarActionButton } from '../types/toolbar';
import type { DetailPanelPosition, DetailPanelProps } from '../types/detail-panel';
import type { CockpitRef } from '../types/cockpit-ref';
import type { RowColorRule } from '../types/grid-states';
import type { StickyColumnConfig } from '../hooks/useStickyColumns';
import type { SelectionMode, BatchAction } from '../types/selection';
import type { EditingCell, CellEditorRegistry, OnCellEdit } from '../types/editing';
import type { ExportColumn } from '../utils/export';
import { useRowSelection } from '../hooks/useRowSelection';
import { BatchActionBar } from './BatchActionBar';

export interface CommandCockpitProps<T> {
  // Data
  data: T[];
  columns: CommandColumnDef<T>[];
  getRowId: (row: T) => string;

  // Behavior
  defaultSort?: SortingState | undefined;
  defaultFilters?: ColumnFiltersState | undefined;
  enableGrouping?: boolean | undefined;
  enableVirtualization?: boolean | undefined;
  rowDensity?: 'compact' | 'comfortable' | 'expanded' | undefined;

  // Events
  onRowSelect?: ((row: T) => void) | undefined;
  onRowDoubleClick?: ((row: T) => void) | undefined;
  selectedRowId?: string | null | undefined;

  // Custom renderers
  customRenderers?: CellRendererRegistry | undefined;

  // Persistence
  persistenceKey?: string | undefined;
  onPersistState?: ((state: PersistedGridState) => void) | undefined;
  initialPersistedState?: Partial<PersistedGridState> | undefined;

  // Theme
  theme?: ThemeConfig | undefined;
  themeOverrides?: ThemeOverrides | undefined;

  // Sprint 2: Context menu
  contextMenuActions?: CommandActionItem<T>[] | undefined;

  // Sprint 2: Toolbar
  title?: string | undefined;
  presets?: FilterPreset[] | undefined;
  /** Preset active on first render (its filters/sorting seed the grid; a persisted sort wins over its sort). */
  initialPresetId?: string | undefined;
  /**
   * Fires when the active preset changes — the id of the preset just applied,
   * or null when the active pill was toggled off. Lets a host keep sibling
   * render modes (a timeline, a kanban) on the same preset as the grid.
   */
  onPresetChange?: ((presetId: string | null) => void) | undefined;
  actionButtons?: ToolbarActionButton[] | undefined;
  primaryAction?: PrimaryAction | undefined;
  enableGlobalFilter?: boolean | undefined;
  /** Show the row count beside the title (default true). */
  showRowCount?: boolean | undefined;

  // Sprint 2: Detail panel
  detailPanel?: React.ComponentType<DetailPanelProps<T>> | undefined;
  detailPanelPosition?: DetailPanelPosition | undefined;
  rowIdentifier?: ((row: T) => string) | undefined;

  // Sprint 2: Status bar
  statusItems?: CommandStatusItem<T>[] | undefined;

  // Sprint 2: Keyboard shortcuts
  keyboardShortcuts?: CommandShortcut<T>[] | undefined;

  // Sprint 3: Row styling + loading
  rowClassName?: string | ((row: T) => string) | undefined;
  rowColorRules?: RowColorRule<T>[] | undefined;
  loading?: boolean | undefined;
  emptyState?: React.ReactNode | undefined;

  // Sprint 3: Sticky columns
  pinnedColumns?: StickyColumnConfig | undefined;

  // Sprint 3: Selection + batch actions
  selectionMode?: SelectionMode | undefined;
  batchActions?: BatchAction<T>[] | undefined;

  // Sprint 3: Export
  enableExport?: boolean | undefined;
  exportColumns?: ExportColumn[] | undefined;

  // Sprint 4: Inline editing
  onCellEdit?: OnCellEdit<T> | undefined;
  customEditors?: CellEditorRegistry | undefined;

  // Expandable sub-rows — render custom content below a row when expanded
  renderSubComponent?: ((row: T) => React.ReactNode | null) | undefined;
  getRowCanExpand?: ((row: T) => boolean) | undefined;
}

const DENSITY_CYCLE: ('compact' | 'comfortable' | 'expanded')[] = [
  'compact',
  'comfortable',
  'expanded',
];

function CommandCockpitInner<T>(
  {
    data,
    columns,
    getRowId,
    defaultSort = [],
    defaultFilters = [],
    enableGrouping = false,
    enableVirtualization = false,
    rowDensity: rowDensityProp = 'compact',
    onRowSelect,
    onRowDoubleClick,
    selectedRowId: controlledSelectedRowId,
    customRenderers,
    persistenceKey,
    onPersistState,
    initialPersistedState,
    theme = 'light',
    themeOverrides,
    // Sprint 2 props
    contextMenuActions,
    title,
    presets = [],
    initialPresetId,
    onPresetChange,
    showRowCount,
    actionButtons = [],
    primaryAction,
    enableGlobalFilter = false,
    detailPanel,
    detailPanelPosition = 'right',
    rowIdentifier,
    statusItems,
    keyboardShortcuts,
    // Sprint 3
    rowClassName,
    rowColorRules,
    loading = false,
    emptyState,
    pinnedColumns,
    selectionMode = 'none',
    batchActions = [],
    enableExport = false,
    exportColumns,
    // Sprint 4: Inline editing
    onCellEdit,
    customEditors,
    // Expandable sub-rows
    renderSubComponent,
    getRowCanExpand,
  }: CommandCockpitProps<T>,
  ref: React.Ref<CockpitRef<T>>
) {
  // State with optional initial restoration
  const initialPreset = initialPresetId ? presets.find((p) => p.id === initialPresetId) : undefined;
  const [sorting, setSorting] = useState<SortingState>(
    initialPersistedState?.sorting ?? initialPreset?.sorting ?? defaultSort
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    initialPreset?.filters ?? defaultFilters
  );
  const [grouping, setGrouping] = useState<GroupingState>(
    initialPersistedState?.grouping ?? []
  );
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialPersistedState?.columnVisibility ?? {}
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    initialPersistedState?.columnOrder ?? columns.map((c) => c.id)
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    initialPersistedState?.columnWidths ?? {}
  );
  const [rowDensity, setRowDensity] = useState<'compact' | 'comfortable' | 'expanded'>(
    initialPersistedState?.rowDensity ?? rowDensityProp
  );

  // Sprint 2 state
  const [globalFilter, setGlobalFilter] = useState(
    initialPersistedState?.globalFilter ?? ''
  );
  const [internalSelectedRowId, setInternalSelectedRowId] = useState<string | null>(null);

  // Detail panel pin state — persisted in localStorage so it survives mode transitions
  const panelPinKey = persistenceKey ? `${persistenceKey}:detailPanelPinned` : null;
  const [detailPanelPinned, setDetailPanelPinned] = useState(() => {
    if (panelPinKey) {
      try { return localStorage.getItem(panelPinKey) === 'true'; } catch { return false; }
    }
    return false;
  });
  const [detailPanelOpen, setDetailPanelOpen] = useState(detailPanelPinned);
  const [detailPanelRowId, setDetailPanelRowId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(initialPreset?.id ?? null);
  const [detailPanelWidth, setDetailPanelWidth] = useState(
    initialPersistedState?.detailPanelWidth ?? 400
  );

  // Sprint 4: Inline editing state
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);

  // Refs
  const cockpitContainerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const globalFilterRef = useRef<HTMLInputElement>(null);
  const visibleRowIdsRef = useRef<string[]>([]);
  // null until the grid has reported its first row model (#909): an empty
  // array after that is a real "nothing matches", not "not yet measured".
  const [filteredRowIds, setFilteredRowIds] = useState<string[] | null>(null);

  // Selected row ID — controlled or internal
  const selectedRowId = controlledSelectedRowId ?? internalSelectedRowId;

  // Ref always tracks the latest selectedRowId — used in navigateRow to avoid stale closures
  const selectedRowIdRef = useRef(selectedRowId);
  selectedRowIdRef.current = selectedRowId;

  // Build data row map for lookups
  const rowMap = useMemo(() => {
    const map = new Map<string, T>();
    for (const row of data) {
      map.set(getRowId(row), row);
    }
    return map;
  }, [data, getRowId]);

  const selectedRow = selectedRowId ? (rowMap.get(selectedRowId) ?? null) : null;

  // Filtered rows for status bar — derived from tracked visible row IDs
  const filteredRows = useMemo(() => {
    if (filteredRowIds === null || filteredRowIds.length === data.length) return data;
    return filteredRowIds.map((id) => rowMap.get(id)!).filter(Boolean);
  }, [filteredRowIds, data, rowMap]);

  // Track visual row order from CommandGrid (respects sort/filter)
  const handleVisibleRowIdsChange = useCallback((ids: string[]) => {
    visibleRowIdsRef.current = ids;
    setFilteredRowIds(ids);
  }, []);

  // Persistence
  const { persist } = usePersistedState({
    persistenceKey,
    onPersistState,
    initialPersistedState,
  });

  useEffect(() => {
    if (!onPersistState) return;
    persist({
      columnOrder,
      columnWidths: columnSizing,
      columnVisibility,
      sorting,
      grouping,
      rowDensity,
      globalFilter: globalFilter || undefined,
      detailPanelWidth,
    });
  }, [
    columnOrder, columnSizing, columnVisibility, sorting, grouping,
    rowDensity, globalFilter, detailPanelWidth,
    persist, onPersistState,
  ]);

  // Row selection handler
  const handleRowSelect = useCallback(
    (row: T) => {
      const id = getRowId(row);
      setInternalSelectedRowId(id);
      onRowSelect?.(row);
      if (detailPanelOpen || detailPanelPinned) {
        setDetailPanelRowId(id);
        if (!detailPanelOpen) setDetailPanelOpen(true);
      }

      // Focus the cockpit container so keyboard shortcuts (arrow nav, etc.) work
      cockpitContainerRef.current?.focus();
    },
    [getRowId, onRowSelect, detailPanelOpen, detailPanelPinned]
  );

  // Row double-click handler
  const handleRowDoubleClick = useCallback(
    (row: T) => {
      if (detailPanel) {
        const id = getRowId(row);
        setDetailPanelRowId(id);
        setDetailPanelOpen(true);
      }
      onRowDoubleClick?.(row);
    },
    [getRowId, detailPanel, onRowDoubleClick]
  );

  // Context menu handler
  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, row: T) => {
      if (!contextMenuActions?.length) return;
      const id = getRowId(row);
      setInternalSelectedRowId(id);
      onRowSelect?.(row);
      setContextMenu({ x: e.clientX, y: e.clientY, rowId: id });
    },
    [contextMenuActions, getRowId, onRowSelect]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Density cycling
  const cycleDensity = useCallback(() => {
    setRowDensity((prev) => {
      const idx = DENSITY_CYCLE.indexOf(prev);
      return DENSITY_CYCLE[(idx + 1) % DENSITY_CYCLE.length] ?? 'compact';
    });
  }, []);

  // Detail panel controls
  const openDetailPanel = useCallback((rowId: string) => {
    setDetailPanelRowId(rowId);
    setDetailPanelOpen(true);
  }, []);

  const closeDetailPanel = useCallback(() => {
    // Pinned panels can't be closed — must unpin first
    if (detailPanelPinned) return;
    setDetailPanelOpen(false);
  }, [detailPanelPinned]);

  const toggleDetailPanelPin = useCallback(() => {
    const next = !detailPanelPinned;
    setDetailPanelPinned(next);
    if (panelPinKey) {
      try {
        if (next) localStorage.setItem(panelPinKey, 'true');
        else localStorage.removeItem(panelPinKey);
      } catch { /* ignore */ }
    }
  }, [detailPanelPinned, panelPinKey]);

  // Row navigation — uses visual row order (respects sort/filter)
  // Uses selectedRowIdRef to always read the latest value, avoiding stale closures
  // during rapid arrow key presses.
  const navigateRow = useCallback(
    (direction: 'prev' | 'next') => {
      const currentId = selectedRowIdRef.current;
      const ids = visibleRowIdsRef.current;
      if (ids.length === 0) return;
      const currentIndex = currentId ? ids.indexOf(currentId) : -1;
      const delta = direction === 'next' ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(ids.length - 1, currentIndex + delta));
      const nextId = ids[nextIndex];
      if (nextId !== undefined) {
        const nextRow = rowMap.get(nextId);
        if (nextRow) {
          setInternalSelectedRowId(nextId);
          selectedRowIdRef.current = nextId; // Update ref immediately for rapid presses
          onRowSelect?.(nextRow);
          if (detailPanelOpen) {
            setDetailPanelRowId(nextId);
          }
        }
      }
    },
    [rowMap, onRowSelect, detailPanelOpen]
  );

  // Sprint 4: Editing handlers
  const handleStartEditing = useCallback((rowId: string, columnId: string) => {
    setEditingCell({ rowId, columnId });
  }, []);

  const handleStopEditing = useCallback(() => {
    setEditingCell(null);
  }, []);

  // Preset handling
  const handlePresetChange = useCallback(
    (preset: FilterPreset) => {
      if (activePresetId === preset.id) {
        // Toggle off
        setActivePresetId(null);
        setColumnFilters(defaultFilters);
        setSorting(defaultSort);
        setGlobalFilter('');
        onPresetChange?.(null);
      } else {
        setActivePresetId(preset.id);
        if (preset.filters) setColumnFilters(preset.filters);
        if (preset.sorting) setSorting(preset.sorting);
        if (preset.globalFilter !== undefined) setGlobalFilter(preset.globalFilter);
        onPresetChange?.(preset.id);
      }
    },
    [activePresetId, defaultFilters, defaultSort, onPresetChange]
  );

  // Programmatic preset application (keyboard 1-5 etc.) — same path as the toolbar pill
  const applyPreset = useCallback(
    (target: string | number) => {
      const preset = typeof target === 'number' ? presets[target] : presets.find((p) => p.id === target);
      if (preset) handlePresetChange(preset);
    },
    [presets, handlePresetChange]
  );

  // Build CockpitRef
  const cockpitRefValue = useRef<CockpitRef<T>>(null!);
  cockpitRefValue.current = {
    selectedRow,
    selectedRowId,
    selectRow: (id) => {
      setInternalSelectedRowId(id);
      if (id) {
        const row = rowMap.get(id);
        if (row) onRowSelect?.(row);
      }
    },
    openDetailPanel,
    closeDetailPanel,
    isDetailPanelOpen: detailPanelOpen,
    navigateRow,
    focusGlobalFilter: () => globalFilterRef.current?.focus(),
    setGlobalFilter,
    getData: () => data,
    getFilteredRows: () => visibleRowIdsRef.current.map((id) => rowMap.get(id)!).filter(Boolean),
    cycleDensity,
    applyPreset,
    activePresetId,
    openContextMenu: (rowId: string, position: { x: number; y: number }) => {
      setInternalSelectedRowId(rowId);
      const row = rowMap.get(rowId);
      if (row) onRowSelect?.(row);
      setContextMenu({ x: position.x, y: position.y, rowId });
    },
    getSelectedIds: () => Array.from(selectionState.selectedIds),
    getSelectedRows: () => selectedRows,
    clearSelection: () => selectionState.clearSelection(),
    selectAll: () => selectionState.toggleAll(),
    // Sprint 4: Inline editing
    startEditing: handleStartEditing,
    stopEditing: (save?: boolean) => {
      if (!save && editingCell) {
        setEditingCell(null);
      } else {
        handleStopEditing();
      }
    },
    // Expandable sub-rows
    toggleRowExpanded: (rowId: string) => {
      setExpanded((prev) => {
        const next = typeof prev === 'boolean' ? {} : { ...prev };
        next[rowId] = !next[rowId];
        return next;
      });
    },
    isRowExpanded: (rowId: string) => {
      return typeof expanded === 'boolean' ? expanded : !!expanded[rowId];
    },
  };

  // Expose cockpit ref to parent via forwardRef
  useImperativeHandle(ref, () => cockpitRefValue.current);

  // Auto-open/populate detail panel when pinned and data loads (e.g., returning from workspace)
  useEffect(() => {
    if (detailPanelPinned && data.length > 0) {
      if (!detailPanelOpen || !detailPanelRowId) {
        // Prefer the previously selected row (survives workspace transition via parent state)
        const targetId = controlledSelectedRowId
          || internalSelectedRowId
          || (data[0] !== undefined ? getRowId(data[0]) : null);
        if (!targetId) return;
        setDetailPanelRowId(targetId);
        setDetailPanelOpen(true);
        setInternalSelectedRowId(targetId);
      }
    }
  }, [detailPanelPinned, detailPanelOpen, detailPanelRowId, data, getRowId, controlledSelectedRowId, internalSelectedRowId]);

  // Keyboard shortcuts
  const { shortcutList } = useKeyboardShortcuts({
    containerRef: cockpitContainerRef,
    gridRef,
    cockpitRef: cockpitRefValue,
    shortcuts: keyboardShortcuts,
    enabled: true,
  });


  // Selection — use the filteredRowIds state (updated by handleVisibleRowIdsChange)
  // Falls back to all data row IDs if no filter is active
  const selectionRowIds = useMemo(
    () => filteredRowIds && filteredRowIds.length > 0 ? filteredRowIds : data.map(getRowId),
    [filteredRowIds, data, getRowId]
  );
  const selectionState = useRowSelection({ filteredRowIds: selectionRowIds });

  const selectedRows = useMemo(() => {
    const rows: T[] = [];
    for (const id of selectionState.selectedIds) {
      const row = rowMap.get(id);
      if (row) rows.push(row);
    }
    return rows;
  }, [selectionState.selectedIds, rowMap]);

  // Detail panel row
  const detailRow = detailPanelRowId ? (rowMap.get(detailPanelRowId) ?? null) : null;

  // Rows in front of the user after presets, column filters and the global
  // filter — the grid reports its row model up (#909). The toolbar shows
  // "24 of 30" whenever that is fewer than the board holds.
  const filteredRowCount = filteredRows.length;

  // Show toolbar if any toolbar features are enabled
  const showToolbar = !!(title || presets.length || actionButtons.length || enableGlobalFilter || primaryAction);
  const showStatusBar = !!(statusItems?.length || shortcutList.length);

  return (
    <ThemeProvider theme={theme} themeOverrides={themeOverrides}>
      <div className="gc-cockpit" ref={cockpitContainerRef} tabIndex={0} style={{ outline: 'none' }}>
        {showToolbar && (
          <CommandToolbar
            title={title}
            rowCount={data.length}
            filteredRowCount={filteredRowCount}
            showRowCount={showRowCount}
            enableGlobalFilter={enableGlobalFilter}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            globalFilterRef={globalFilterRef}
            presets={presets}
            actionButtons={actionButtons}
            activePresetId={activePresetId}
            onPresetChange={handlePresetChange}
            rowDensity={rowDensity}
            onCycleDensity={cycleDensity}
            columns={columns}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            primaryAction={primaryAction}
            enableExport={enableExport}
            exportColumns={exportColumns}
            filteredRows={data}
            selectedRows={selectedRows}
          />
        )}

        {selectionMode === 'multi' && batchActions.length > 0 && (
          <BatchActionBar
            selectedCount={selectionState.selectedCount}
            selectedIds={Array.from(selectionState.selectedIds)}
            selectedRows={selectedRows}
            actions={batchActions}
            onClearSelection={selectionState.clearSelection}
          />
        )}

        <div className={`gc-cockpit-body gc-cockpit-body--${detailPanelPosition}`}>
          <CommandGrid
            data={data}
            columns={columns}
            getRowId={getRowId}
            enableGrouping={enableGrouping}
            enableVirtualization={enableVirtualization}
            rowDensity={rowDensity}
            onRowSelect={handleRowSelect}
            onRowDoubleClick={handleRowDoubleClick}
            onRowContextMenu={contextMenuActions?.length ? handleRowContextMenu : undefined}
            selectedRowId={selectedRowId}
            customRenderers={customRenderers}
            sorting={sorting}
            onSortingChange={setSorting}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            grouping={grouping}
            onGroupingChange={setGrouping}
            expanded={expanded}
            onExpandedChange={setExpanded}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            columnOrder={columnOrder}
            onColumnOrderChange={setColumnOrder}
            columnSizing={columnSizing}
            onColumnSizingChange={setColumnSizing}
            globalFilter={globalFilter}
            onGlobalFilterChange={setGlobalFilter}
            rowClassName={rowClassName}
            rowColorRules={rowColorRules}
            loading={loading}
            emptyState={emptyState}
            pinnedColumns={pinnedColumns}
            selectionMode={selectionMode}
            selectionState={selectionMode === 'multi' ? selectionState : undefined}
            onVisibleRowIdsChange={handleVisibleRowIdsChange}
            editingCell={editingCell}
            onStartEditing={handleStartEditing}
            onCellEdit={onCellEdit}
            onStopEditing={handleStopEditing}
            customEditors={customEditors}
            renderSubComponent={renderSubComponent}
            getRowCanExpand={getRowCanExpand}
          />

          {detailPanel && (
            <CommandDetailPanel
              open={detailPanelOpen}
              row={detailRow}
              rowId={detailPanelRowId}
              rowIdentifier={rowIdentifier}
              cockpit={cockpitRefValue.current}
              position={detailPanelPosition}
              width={detailPanelWidth}
              onWidthChange={setDetailPanelWidth}
              onClose={closeDetailPanel}
              onNavigate={navigateRow}
              renderContent={detailPanel}
              pinned={detailPanelPinned}
              onTogglePin={toggleDetailPanelPin}
            />
          )}
        </div>

        {showStatusBar && (
          <CommandStatusBar
            items={statusItems}
            data={filteredRows}
            allData={data}
            cockpit={cockpitRefValue.current}
            shortcutHints={shortcutList}
          />
        )}

        {/* Context menu */}
        {contextMenu && contextMenuActions && selectedRow && (
          <CommandContextMenu
            items={contextMenuActions}
            row={selectedRow}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            cockpit={cockpitRefValue.current}
            onClose={closeContextMenu}
            containerRef={cockpitContainerRef}
          />
        )}
      </div>
    </ThemeProvider>
  );
}

// forwardRef wrapper — preserves generic type parameter via cast
export const CommandCockpit = forwardRef(CommandCockpitInner) as <T>(
  props: CommandCockpitProps<T> & { ref?: React.Ref<CockpitRef<T>> }
) => React.ReactElement | null;
