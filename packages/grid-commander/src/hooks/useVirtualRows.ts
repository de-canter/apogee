import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_HEIGHTS = {
  compact: 28,
  comfortable: 36,
  expanded: 48,
};

export interface UseVirtualRowsOptions {
  rowCount: number;
  rowDensity: 'compact' | 'comfortable' | 'expanded';
  enabled: boolean;
}

export function useVirtualRows({ rowCount, rowDensity, enabled }: UseVirtualRowsOptions) {
  const parentRef = useRef<HTMLDivElement>(null);
  const estimatedSize = ROW_HEIGHTS[rowDensity];

  const virtualizer = useVirtualizer({
    count: enabled ? rowCount : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedSize,
    overscan: 10,
  });

  const scrollToIndex = useCallback(
    (index: number) => {
      if (enabled) {
        virtualizer.scrollToIndex(index, { align: 'auto' });
      }
    },
    [virtualizer, enabled]
  );

  return {
    parentRef,
    virtualizer,
    virtualItems: enabled ? virtualizer.getVirtualItems() : [],
    totalSize: enabled ? virtualizer.getTotalSize() : 0,
    scrollToIndex,
  };
}
