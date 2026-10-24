import type { CellRendererProps } from '../../types/column';
import { formatDate } from '../../utils/dates';
import { asDateInput } from './text';

/** A date that is history, not a deadline: plain text, never coloured. */
export function DateCell({ value }: CellRendererProps) {
  const date = asDateInput(value);
  if (!date) return <span className="gc-cell-text">{'—'}</span>;
  return <span className="gc-cell-text gc-cell-date">{formatDate(date)}</span>;
}
