import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { RowSelectionState } from '../types/selection';

interface UseRowSelectionOptions {
  /** All filtered row IDs in display order */
  filteredRowIds: string[];
}

export function useRowSelection({
  filteredRowIds,
}: UseRowSelectionOptions): RowSelectionState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);

  // Clear selection when filtered rows change
  const filteredKey = filteredRowIds.join(',');
  useEffect(() => {
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, [filteredKey]);

  const toggleRow = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastSelectedIdRef.current = id;
    },
    []
  );

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = filteredRowIds.length > 0 && filteredRowIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set();
      } else {
        return new Set(filteredRowIds);
      }
    });
  }, [filteredRowIds]);

  const selectRange = useCallback(
    (fromId: string, toId: string) => {
      const fromIdx = filteredRowIds.indexOf(fromId);
      const toIdx = filteredRowIds.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return;

      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      const rangeIds = filteredRowIds.slice(start, end + 1);

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of rangeIds) {
          next.add(id);
        }
        return next;
      });
      lastSelectedIdRef.current = toId;
    },
    [filteredRowIds]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const isAllSelected = useMemo(
    () => filteredRowIds.length > 0 && filteredRowIds.every((id) => selectedIds.has(id)),
    [filteredRowIds, selectedIds]
  );

  const isPartiallySelected = useMemo(
    () => selectedIds.size > 0 && !isAllSelected,
    [selectedIds.size, isAllSelected]
  );

  return {
    selectedIds,
    isAllSelected,
    isPartiallySelected,
    selectedCount: selectedIds.size,
    toggleRow,
    toggleAll,
    selectRange,
    clearSelection,
    isSelected,
  };
}
