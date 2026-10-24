import type React from 'react';

export interface RowColorRule<T = unknown> {
  /** Predicate — receives the row data */
  match: (row: T) => boolean;
  /** CSS class name to apply to the row <tr>/<div> */
  className?: string | undefined;
  /** Inline style overrides */
  style?: React.CSSProperties | undefined;
}

export interface GridSkeletonProps {
  rows?: number | undefined;
  columns?: number | undefined;
  density?: 'compact' | 'comfortable' | 'expanded' | undefined;
}

export interface GridEmptyStateProps {
  icon?: React.ReactNode | undefined;
  title?: string | undefined;
  description?: string | undefined;
  action?: React.ReactNode | undefined;
}
