import type { CellRendererProps } from '../../types/column';
import { formatDate } from '../../utils/dates';

/**
 * A date that is history, not a deadline (#920): an effective date, the day a
 * file closed, the day an examination was assigned. Plain text — red means
 * "act", and nothing here is late.
 */
export function DateCell({ value }: CellRendererProps) {
  if (!value) return <span className="gc-cell-text">{'—'}</span>;
  return <span className="gc-cell-text gc-cell-date">{formatDate(value)}</span>;
}
