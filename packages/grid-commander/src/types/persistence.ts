import type { SortingState } from '@tanstack/react-table';

export interface PersistedGridState {
  columnOrder: string[];
  columnWidths: Record<string, number>;
  columnVisibility: Record<string, boolean>;
  sorting: SortingState;
  grouping: string[];
  rowDensity: 'compact' | 'comfortable' | 'expanded';
  globalFilter?: string;
  detailPanelWidth?: number;
}

export interface ColumnStateChange {
  columnOrder: string[];
  columnWidths: Record<string, number>;
  columnVisibility: Record<string, boolean>;
}
