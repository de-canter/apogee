// === Types ===
export type {
  CommandColumnDef,
  CellRendererProps,
  CellRendererFn,
  CellRendererRegistry,
  FilterType,
  ColumnAlign,
  StickyPosition,
} from './types/column';

export type {
  CommandAction,
  CommandInlineAction,
  ActionDivider,
  CommandActionItem,
} from './types/actions';

export type { CommandShortcut } from './types/shortcuts';
export type { CommandStatusItem } from './types/status-bar';

export type {
  PersistedGridState,
  ColumnStateChange,
} from './types/persistence';

export type {
  ThemeConfig,
  ThemeOverrides,
  ThemeProviderProps,
} from './types/theme';

export type { CockpitRef } from './types/cockpit-ref';
export type { FilterPreset, PrimaryAction, ToolbarActionButton } from './types/toolbar';
export type { DetailPanelProps, DetailPanelPosition } from './types/detail-panel';

// Sprint 3: Grid states
export type { RowColorRule, GridSkeletonProps, GridEmptyStateProps } from './types/grid-states';

// Sprint 3: Selection
export type { SelectionMode, BatchAction, RowSelectionState } from './types/selection';

// Sprint 3: Sticky columns
export type { StickyColumnConfig } from './hooks/useStickyColumns';

// Sprint 3: Export
export type { ExportColumn } from './utils/export';

// Sprint 4: Inline editing
export type {
  CellEditorProps,
  CellEditorFn,
  CellEditorRegistry,
  EditingCell,
  OnCellEdit,
} from './types/editing';

// === Components ===
export { ThemeProvider } from './themes/ThemeProvider';
export { CommandGrid } from './components/CommandGrid';
export type { CommandGridProps } from './components/CommandGrid';
export { CommandCockpit } from './components/CommandCockpit';
export type { CommandCockpitProps } from './components/CommandCockpit';
export { CommandContextMenu } from './components/CommandContextMenu';
export type { CommandContextMenuProps, ContextMenuState } from './components/CommandContextMenu';
export { CommandToolbar } from './components/CommandToolbar';
export type { CommandToolbarProps } from './components/CommandToolbar';
export { CommandStatusBar } from './components/CommandStatusBar';
export type { CommandStatusBarProps } from './components/CommandStatusBar';
export { CommandDetailPanel } from './components/CommandDetailPanel';
export type { CommandDetailPanelProps } from './components/CommandDetailPanel';

// Sprint 3: New components
export { GridSkeleton } from './components/GridSkeleton';
export { GridEmptyState } from './components/GridEmptyState';
export { CheckboxCell } from './components/renderers/CheckboxCell';
export { BatchActionBar } from './components/BatchActionBar';
export { ExportMenu } from './components/ExportMenu';

// === Detail Components ===
export { CollapsibleSection } from './components/detail/CollapsibleSection';
export type { CollapsibleSectionProps } from './components/detail/CollapsibleSection';
export { SummaryChip } from './components/detail/SummaryChip';
export type { SummaryChipProps } from './components/detail/SummaryChip';
export { StatusBadge } from './components/detail/StatusBadge';
export type { StatusBadgeProps } from './components/detail/StatusBadge';
export { ActionButton } from './components/detail/ActionButton';
export type { ActionButtonProps } from './components/detail/ActionButton';
export { ContactGrid } from './components/detail/ContactGrid';
export type { ContactGridProps, Contact } from './components/detail/ContactGrid';
export { ActivityLog, groupActivityByDay } from './components/detail/ActivityLog';
export type { ActivityLogProps, ActivityEntry, ActivityType, ActivityTabsMode, ActivityDayGroup } from './components/detail/ActivityLog';

// === Renderers ===
export { createRendererRegistry, builtInRenderers } from './components/renderers/registry';

// === Editors ===
export { createEditorRegistry, builtInEditors, getEditor } from './components/editors/registry';
export { TextInputEditor } from './components/editors/TextInputEditor';
export { SelectEditor } from './components/editors/SelectEditor';
export { DateEditor } from './components/editors/DateEditor';

// === Hooks ===
export { usePersistedState } from './hooks/usePersistedState';
export { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
export type { UseKeyboardShortcutsOptions, UseKeyboardShortcutsReturn, ShortcutEntry } from './hooks/useKeyboardShortcuts';
export { useRowSelection } from './hooks/useRowSelection';
export { useStickyColumns } from './hooks/useStickyColumns';

// === Utils ===
export { formatCurrency } from './utils/formatting';
export { validateColumnDefs } from './utils/validation';
export { formatCsv, formatJson, downloadFile } from './utils/export';
