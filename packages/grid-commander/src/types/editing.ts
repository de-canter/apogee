import type { ReactNode } from 'react';

/**
 * Props passed to a cell editor component.
 */
export interface CellEditorProps<TRow = unknown, TValue = unknown> {
  value: TValue;
  row: TRow;
  config: Record<string, unknown>;
  columnId: string;
  onCommit: (newValue: TValue) => void;
  onCancel: () => void;
}

/**
 * A cell editor function — returns a ReactNode for inline editing.
 */
export type CellEditorFn<TRow = unknown> = {
  bivarianceHack(props: CellEditorProps<TRow>): ReactNode;
}['bivarianceHack'];

/**
 * Registry mapping editor names to editor functions.
 */
export type CellEditorRegistry = Record<string, CellEditorFn>;

/**
 * Identifies which cell is currently being edited.
 */
export interface EditingCell {
  rowId: string;
  columnId: string;
}

/**
 * Callback when a cell edit is committed.
 */
export type OnCellEdit<T = unknown> = (
  rowId: string,
  columnId: string,
  value: unknown,
  row: T
) => void;
