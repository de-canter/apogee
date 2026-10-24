import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  type SortingState,
  type ColumnFiltersState,
  type GroupingState,
  type ExpandedState,
  type VisibilityState,
  type ColumnOrderState,
  type ColumnSizingState,
  type ColumnDef,
} from '@tanstack/react-table';
import type { CommandColumnDef } from '../types/column';

export interface UseGridTableOptions<T> {
  data: T[];
  columns: CommandColumnDef<T>[];
  getRowId: (row: T) => string;
  sorting: SortingState;
  onSortingChange: (updater: SortingState | ((prev: SortingState) => SortingState)) => void;
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (
    updater: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)
  ) => void;
  grouping: GroupingState;
  onGroupingChange: (updater: GroupingState | ((prev: GroupingState) => GroupingState)) => void;
  expanded: ExpandedState;
  onExpandedChange: (updater: ExpandedState | ((prev: ExpandedState) => ExpandedState)) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (
    updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)
  ) => void;
  columnOrder: ColumnOrderState;
  onColumnOrderChange: (
    updater: ColumnOrderState | ((prev: ColumnOrderState) => ColumnOrderState)
  ) => void;
  columnSizing: ColumnSizingState;
  onColumnSizingChange: (
    updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)
  ) => void;
  enableGrouping: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  getRowCanExpand?: (row: T) => boolean;
}

export function useGridTable<T>(options: UseGridTableOptions<T>) {
  const {
    data,
    columns,
    getRowId,
    sorting,
    onSortingChange,
    columnFilters,
    onColumnFiltersChange,
    grouping,
    onGroupingChange,
    expanded,
    onExpandedChange,
    columnVisibility,
    onColumnVisibilityChange,
    columnOrder,
    onColumnOrderChange,
    columnSizing,
    onColumnSizingChange,
    enableGrouping,
    globalFilter,
    onGlobalFilterChange,
    getRowCanExpand: getRowCanExpandProp,
  } = options;

  const tanstackColumns = useMemo(
    () =>
      columns.map((col) => ({
        ...col,
        enableColumnFilter: col.filterType != null,
        enableSorting: col.enableSorting ?? true,
        enableGrouping: enableGrouping,
      })) as ColumnDef<T, any>[],
    [columns, enableGrouping]
  );

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    getRowId,
    state: {
      sorting,
      columnFilters,
      grouping,
      expanded,
      columnVisibility,
      columnOrder,
      columnSizing,
      ...(globalFilter !== undefined ? { globalFilter } : {}),
    },
    onSortingChange: onSortingChange as any,
    onColumnFiltersChange: onColumnFiltersChange as any,
    onGroupingChange: onGroupingChange as any,
    onExpandedChange: onExpandedChange as any,
    onColumnVisibilityChange: onColumnVisibilityChange as any,
    onColumnOrderChange: onColumnOrderChange as any,
    onColumnSizingChange: onColumnSizingChange as any,
    onGlobalFilterChange: onGlobalFilterChange as any,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: enableGrouping ? getGroupedRowModel() : undefined,
    getExpandedRowModel: (enableGrouping || getRowCanExpandProp) ? getExpandedRowModel() : undefined,
    ...(getRowCanExpandProp ? { getRowCanExpand: (row: any) => getRowCanExpandProp(row.original) } : {}),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    enableGlobalFilter: globalFilter !== undefined,
  });

  return table;
}
