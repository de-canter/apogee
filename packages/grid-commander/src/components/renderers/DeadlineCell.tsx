import type { CellRendererProps } from '../../types/column';
import { daysUntil, formatDate } from '../../utils/dates';
import { bool, num, str } from '../../utils/config';
import { asDateInput, asRecord } from './text';

/** A date that is a deadline: coloured by distance, with an optional countdown. Dates only; see `countdown` for published numbers. */
export function DeadlineCell({ value, row, config }: CellRendererProps) {
  const date = asDateInput(value);
  if (!date) return <span className="gc-cell-text">{'—'}</span>;

  // A deadline that has been met is not late: `doneField` names a truthy field on the row.
  const doneField = str(config, 'doneField');
  const showCountdown = bool(config, 'showCountdown');
  if (doneField && asRecord(row)[doneField]) {
    return (
      <span className="gc-cell-deadline">
        <span style={{ color: 'var(--gc-text-muted)', fontWeight: 600 }}>{formatDate(date)}</span>
        {showCountdown && (
          <span className="gc-cell-countdown" style={{ color: 'var(--gc-text-dim)', marginLeft: 4 }}>
            {str(config, 'doneLabel', 'done')}
          </span>
        )}
      </span>
    );
  }

  const days = daysUntil(date);
  const criticalDays = num(config, 'criticalDays', 3);
  const warningDays = num(config, 'warningDays', 7);
  const color =
    days < 0 ? 'var(--gc-red)' : days <= criticalDays ? 'var(--gc-orange)' : days <= warningDays ? 'var(--gc-yellow)' : 'var(--gc-green)';
  const label = days < 0 ? `${Math.abs(days)}d late` : days === 0 ? 'TODAY' : `${days}d`;

  return (
    <span className="gc-cell-deadline">
      <span style={{ color, fontWeight: 700 }}>{formatDate(date)}</span>
      {showCountdown && (
        <span className="gc-cell-countdown" style={{ color: 'var(--gc-text-dim)', marginLeft: 4 }}>
          {label}
        </span>
      )}
    </span>
  );
}
