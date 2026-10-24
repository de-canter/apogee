import type { SortingState, ColumnFiltersState } from '@tanstack/react-table';

/**
 * Saved filter/sort preset applied via toolbar pill buttons.
 */
export interface FilterPreset {
  id: string;
  label: string;
  icon?: string | undefined;
  filters?: ColumnFiltersState | undefined;
  sorting?: SortingState | undefined;
  globalFilter?: string | undefined;
}

/**
 * Primary action button displayed at the right of the toolbar.
 */
export interface PrimaryAction {
  label: string;
  icon?: string | undefined;
  onClick: () => void;
  disabled?: boolean | undefined;
  /** Attached to the rendered <button> so popovers can anchor to it. */
  buttonRef?: React.Ref<HTMLButtonElement> | undefined;
}

/**
 * Action button displayed in the toolbar between presets and search.
 * Visually distinct from filter presets — these trigger actions, not filters.
 */
export interface ToolbarActionButton {
  id: string;
  label: string;
  icon?: string | undefined;
  shortcut?: string | undefined;
  accentColor?: string | undefined;
  onClick: () => void;
  disabled?: boolean | undefined;
  /** Attached to the rendered <button> so popovers can anchor to it. */
  buttonRef?: React.Ref<HTMLButtonElement> | undefined;
  /** `data-testid` on the rendered <button>. */
  testId?: string | undefined;
  /** Tooltip; defaults to the label (with the shortcut, when there is one). */
  title?: string | undefined;
}
