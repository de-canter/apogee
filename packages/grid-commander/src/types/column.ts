import type { ColumnDef } from '@tanstack/react-table';

export type FilterType = 'text' | 'select' | 'date-range' | 'number-range' | 'boolean';
export type ColumnAlign = 'left' | 'center' | 'right';
export type StickyPosition = 'left' | 'right';

export interface CellRendererProps<TRow = unknown, TValue = unknown> {
  value: TValue;
  row: TRow;
  config: Record<string, unknown>;
  columnId: string;
}

/**
 * Method-style signature (bivariant) so a renderer written for one row type can live in a registry
 * shared across cockpits; the registry is keyed by name, not by row type.
 */
export type CellRendererFn<TRow = unknown> = {
  bivarianceHack(props: CellRendererProps<TRow>): React.ReactNode;
}['bivarianceHack'];

export type CellRendererRegistry = Record<string, CellRendererFn>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Extended column definition with cockpit-specific properties. TanStack's `ColumnDef` is a union
 * (accessor key, accessor fn, display), so the omit distributes over it.
 */
export type CommandColumnDef<T> = DistributiveOmit<ColumnDef<T, unknown>, 'id'> & {
  id: string;
  cellRenderer?: string | undefined;
  cellConfig?: Record<string, unknown> | undefined;
  cellStyle?: React.CSSProperties | undefined;
  filterType?: FilterType | undefined;
  filterOptions?: string[] | undefined;
  /** Display labels for select filter options (value -> label). Falls back to the raw value. */
  filterOptionLabels?: Record<string, string> | undefined;
  sticky?: StickyPosition | undefined;
  align?: ColumnAlign | undefined;
  // Inline editing
  editable?: boolean | undefined;
  cellEditor?: string | undefined;
  cellEditorConfig?: Record<string, unknown> | undefined;
};
