import type { GridSkeletonProps } from '../types/grid-states';

const DENSITY_HEIGHTS: Record<string, number> = {
  compact: 28,
  comfortable: 36,
  expanded: 48,
};

export function GridSkeleton({
  rows = 8,
  columns = 5,
  density = 'compact',
}: GridSkeletonProps) {
  const rowHeight = DENSITY_HEIGHTS[density] || 28;

  return (
    <div className="gc-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, rowIdx) => (
        <div
          key={rowIdx}
          className="gc-skeleton-row"
          style={{ height: rowHeight }}
        >
          {Array.from({ length: columns }, (_, colIdx) => (
            <div
              key={colIdx}
              className="gc-skeleton-cell"
              style={{ width: colIdx === 0 ? '40%' : `${60 / (columns - 1)}%` }}
            >
              <div className="gc-skeleton-bar" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
