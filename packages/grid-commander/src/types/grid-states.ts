import type React from 'react';

export interface RowColorRule<T = any> {
  /** Predicate — receives the row data */
  match: (row: T) => boolean;
  /** CSS class name to apply to the row <tr>/<div> */
  className?: string;
  /** Inline style overrides */
  style?: React.CSSProperties;
}

export interface GridSkeletonProps {
  rows?: number;
  columns?: number;
  density?: 'compact' | 'comfortable' | 'expanded';
}

export interface GridEmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}
