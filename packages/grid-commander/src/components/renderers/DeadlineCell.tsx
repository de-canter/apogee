import type { CellRendererProps } from '../../types/column';
import { daysUntil, formatDate } from '../../utils/dates';

export function DeadlineCell({ value, row, config }: CellRendererProps) {
  if (!value) return <span className="gc-cell-text">{'\u2014'}</span>;

  // A deadline that has been met is not late. `doneField` names a boolean on
  // the row (e.g. `isClosed`); when set, the date renders quietly with
  // `doneLabel` instead of a countdown.
  const doneField = config.doneField as string | undefined;
  const rowData = (row as { original?: Record<string, unknown> } | undefined)?.original ?? (row as Record<string, unknown> | undefined);
  if (doneField && rowData && rowData[doneField]) {
    return (
      <span className="gc-cell-deadline">
        <span style={{ color: 'var(--gc-text-muted)', fontWeight: 600 }}>{formatDate(value)}</span>
        {config.showCountdown && (
          <span className="gc-cell-countdown" style={{ color: 'var(--gc-text-dim)', marginLeft: 4 }}>
            {(config.doneLabel as string | undefined) ?? 'done'}
          </span>
        )}
      </span>
    );
  }

  const days = daysUntil(value);
  const criticalDays = config.criticalDays ?? 3;
  const warningDays = config.warningDays ?? 7;

  const color =
    days < 0
      ? 'var(--gc-red)'
      : days <= criticalDays
        ? 'var(--gc-orange)'
        : days <= warningDays
          ? 'var(--gc-yellow)'
          : 'var(--gc-green)';

  const label =
    days < 0
      ? `${Math.abs(days)}d late`
      : days === 0
        ? 'TODAY'
        : `${days}d`;

  return (
    <span className="gc-cell-deadline">
      <span style={{ color, fontWeight: 700 }}>{formatDate(value)}</span>
      {config.showCountdown && (
        <span className="gc-cell-countdown" style={{ color: 'var(--gc-text-dim)', marginLeft: 4 }}>
          {label}
        </span>
      )}
    </span>
  );
}
