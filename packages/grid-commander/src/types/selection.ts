export type SelectionMode = 'none' | 'single' | 'multi';

export interface BatchAction<T = any> {
  id: string;
  label: string;
  icon?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  /** Called with array of selected row IDs */
  handler: (selectedIds: string[], rows: T[]) => void;
  /** Minimum selected rows to enable (default 1) */
  minSelection?: number;
  /** Maximum selected rows to enable (default Infinity) */
  maxSelection?: number;
  /** Dynamic disabled check */
  disabled?: (selectedIds: string[], rows: T[]) => boolean;
}

export interface RowSelectionState {
  selectedIds: Set<string>;
  isAllSelected: boolean;
  isPartiallySelected: boolean;
  selectedCount: number;
  toggleRow: (id: string) => void;
  toggleAll: () => void;
  selectRange: (fromId: string, toId: string) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
}
