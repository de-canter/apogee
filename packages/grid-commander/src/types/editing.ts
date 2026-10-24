import type { ReactNode } from 'react';

/**
 * Props passed to a cell editor component.
 */
export interface CellEditorProps<T = any> {
  value: any;
  row: T;
  config: Record<string, any>;
  columnId: string;
  onCommit: (newValue: any) => void;
  onCancel: () => void;
}

/**
 * A cell editor function — returns a ReactNode for inline editing.
 */
export type CellEditorFn<T = any> = (props: CellEditorProps<T>) => ReactNode;

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
export type OnCellEdit<T = any> = (
  rowId: string,
  columnId: string,
  value: any,
  row: T
) => void;
