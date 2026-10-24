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
  type OnChangeFn,
  type Row,
} from '@tanstack/react-table';
import type { CommandColumnDef } from '../types/column';
import { filterFnFor } from '../utils/filters';

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
  globalFilter?: string | undefined;
  onGlobalFilterChange?: ((value: string) => void) | undefined;
  getRowCanExpand?: ((row: T) => boolean) | undefined;
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
        ...(col.filterFn === undefined && filterFnFor(col.filterType) ? { filterFn: filterFnFor(col.filterType) } : {}),
        enableSorting: col.enableSorting ?? true,
        enableGrouping: enableGrouping,
      })) as ColumnDef<T, unknown>[],
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
    onSortingChange: onSortingChange,
    onColumnFiltersChange: onColumnFiltersChange,
    onGroupingChange: onGroupingChange,
    onExpandedChange: onExpandedChange,
    onColumnVisibilityChange: onColumnVisibilityChange,
    onColumnOrderChange: onColumnOrderChange,
    onColumnSizingChange: onColumnSizingChange,
    onGlobalFilterChange: onGlobalFilterChange as OnChangeFn<string>,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(enableGrouping ? { getGroupedRowModel: getGroupedRowModel() } : {}),
    ...(enableGrouping || getRowCanExpandProp ? { getExpandedRowModel: getExpandedRowModel() } : {}),
    ...(getRowCanExpandProp ? { getRowCanExpand: (row: Row<T>) => getRowCanExpandProp(row.original) } : {}),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    enableGlobalFilter: globalFilter !== undefined,
  });

  return table;
}
