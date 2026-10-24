/**
 * Stable imperative API exposed to action/shortcut handlers.
 */
export interface CockpitRef<T = any> {
  selectedRow: T | null;
  selectedRowId: string | null;
  selectRow: (id: string | null) => void;
  openDetailPanel: (rowId: string) => void;
  closeDetailPanel: () => void;
  isDetailPanelOpen: boolean;
  navigateRow: (direction: 'prev' | 'next') => void;
  focusGlobalFilter: () => void;
  setGlobalFilter: (value: string) => void;
  getData: () => T[];
  getFilteredRows: () => T[];
  cycleDensity: () => void;
  // Toolbar presets — apply by id or index, same path as clicking the pill
  applyPreset: (preset: string | number) => void;
  activePresetId: string | null;
  // Context menu — allows programmatic opening (e.g. from kebab button)
  openContextMenu: (rowId: string, position: { x: number; y: number }) => void;
  // Sprint 3: Selection
  getSelectedIds: () => string[];
  getSelectedRows: () => T[];
  clearSelection: () => void;
  selectAll: () => void;
  // Sprint 4: Inline editing
  startEditing: (rowId: string, columnId: string) => void;
  stopEditing: (save?: boolean) => void;
  // Expandable sub-rows
  toggleRowExpanded: (rowId: string) => void;
  isRowExpanded: (rowId: string) => boolean;
}
