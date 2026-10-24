import type { ColumnDef } from '@tanstack/react-table';

export type FilterType = 'text' | 'select' | 'date-range' | 'number-range' | 'boolean';
export type ColumnAlign = 'left' | 'center' | 'right';
export type StickyPosition = 'left' | 'right';

export interface CellRendererProps<T = any> {
  value: any;
  row: T;
  config: Record<string, any>;
  columnId: string;
}

export type CellRendererFn<T = any> = (props: CellRendererProps<T>) => React.ReactNode;

export type CellRendererRegistry = Record<string, CellRendererFn>;

/**
 * Extended column definition with cockpit-specific properties.
 * Extends TanStack Table's ColumnDef with cell renderer, filter, and layout options.
 */
export interface CommandColumnDef<T> extends Omit<ColumnDef<T, any>, 'id'> {
  id: string;
  cellRenderer?: string;
  cellConfig?: Record<string, any>;
  cellStyle?: React.CSSProperties;
  filterType?: FilterType;
  filterOptions?: string[];
  /** Display labels for select filter options (value -> label). Falls back to the raw value. */
  filterOptionLabels?: Record<string, string>;
  sticky?: StickyPosition;
  align?: ColumnAlign;
  // Inline editing
  editable?: boolean;
  cellEditor?: string;
  cellEditorConfig?: Record<string, any>;
}
