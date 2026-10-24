import type { SortingState, ColumnFiltersState } from '@tanstack/react-table';

/**
 * Saved filter/sort preset applied via toolbar pill buttons.
 */
export interface FilterPreset {
  id: string;
  label: string;
  icon?: string;
  filters?: ColumnFiltersState;
  sorting?: SortingState;
  globalFilter?: string;
}

/**
 * Primary action button displayed at the right of the toolbar.
 */
export interface PrimaryAction {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Attached to the rendered <button> so popovers can anchor to it. */
  buttonRef?: React.Ref<HTMLButtonElement>;
}

/**
 * Action button displayed in the toolbar between presets and search.
 * Visually distinct from filter presets — these trigger actions, not filters.
 */
export interface ToolbarActionButton {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  accentColor?: string;
  onClick: () => void;
  disabled?: boolean;
  /** Attached to the rendered <button> so popovers can anchor to it. */
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** `data-testid` on the rendered <button>. */
  testId?: string;
  /** Tooltip; defaults to the label (with the shortcut, when there is one). */
  title?: string;
}
