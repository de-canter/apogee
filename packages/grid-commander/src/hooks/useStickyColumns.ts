import { useMemo } from 'react';
import type { ColumnSizingState } from '@tanstack/react-table';
import type { CommandColumnDef } from '../types/column';

export interface StickyColumnConfig {
  /** Column IDs to pin to the left */
  pinnedLeft?: string[] | undefined;
  /** Column IDs to pin to the right */
  pinnedRight?: string[] | undefined;
}

export interface StickyColumnResult {
  /** Returns style object for a column header/cell by column ID */
  getColumnStyle: (columnId: string) => React.CSSProperties;
  /** CSS class to add for a column */
  getColumnClass: (columnId: string) => string;
  /** Whether any columns are pinned */
  hasStickyColumns: boolean;
}

const DEFAULT_COLUMN_WIDTH = 150;

export function useStickyColumns<T = unknown>(
  config: StickyColumnConfig | undefined,
  columns: CommandColumnDef<T>[],
  columnSizing: ColumnSizingState
): StickyColumnResult {
  const pinnedLeft = config?.pinnedLeft ?? [];
  const pinnedRight = config?.pinnedRight ?? [];
  const hasStickyColumns = pinnedLeft.length > 0 || pinnedRight.length > 0;

  const styleMap = useMemo(() => {
    const map = new Map<string, { style: React.CSSProperties; className: string }>();

    if (!hasStickyColumns) return map;

    // Get column width from sizing state or column def or default
    const getWidth = (colId: string): number => {
      if (columnSizing[colId]) return columnSizing[colId];
      const col = columns.find((c) => c.id === colId);
      if (col?.size) return col.size;
      return DEFAULT_COLUMN_WIDTH;
    };

    // Left-pinned columns: cumulative left offsets
    let leftOffset = 0;
    for (const colId of pinnedLeft) {
      map.set(colId, {
        style: {
          position: 'sticky',
          left: leftOffset,
          zIndex: 2,
        },
        className: 'gc-grid-cell--pinned-left',
      });
      leftOffset += getWidth(colId);
    }

    // Right-pinned columns: cumulative right offsets (from last to first)
    let rightOffset = 0;
    for (let i = pinnedRight.length - 1; i >= 0; i--) {
      const colId = pinnedRight[i]!;
      map.set(colId, {
        style: {
          position: 'sticky',
          right: rightOffset,
          zIndex: 2,
        },
        className: 'gc-grid-cell--pinned-right',
      });
      rightOffset += getWidth(colId);
    }

    return map;
  }, [hasStickyColumns, pinnedLeft, pinnedRight, columns, columnSizing]);

  const getColumnStyle = (columnId: string): React.CSSProperties => {
    return styleMap.get(columnId)?.style ?? {};
  };

  const getColumnClass = (columnId: string): string => {
    return styleMap.get(columnId)?.className ?? '';
  };

  return { getColumnStyle, getColumnClass, hasStickyColumns };
}
