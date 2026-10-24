import type { CellRendererProps } from '../../types/column';
import { daysSince } from '../../utils/dates';

/**
 * Renders "today" / "Nd ago" with warning/critical colouring.
 *
 * A missing value (null, undefined, empty string), a non-numeric value, or a
 * negative sentinel (APIs use -1 for "never") renders as an em dash — or as
 * `config.emptyLabel` ("Never contacted") when the column wants the gap to
 * read as a fact rather than a blank.
 */
export function StalenessCell({ value, config }: CellRendererProps) {
  const days = toDays(value);
  if (days === null) {
    const hasEmptyLabel = typeof config?.emptyLabel === 'string';
    return (
      <span style={{ color: hasEmptyLabel ? 'var(--gc-red)' : 'var(--gc-text-muted)', fontSize: 10 }}>
        {hasEmptyLabel ? config.emptyLabel : '—'}
      </span>
    );
  }

  const criticalDays = config?.criticalDays ?? 7;
  const warningDays = config?.warningDays ?? 3;

  const color =
    days > criticalDays
      ? 'var(--gc-red)'
      : days > warningDays
        ? 'var(--gc-yellow)'
        : 'var(--gc-text-muted)';

  return (
    <span style={{ color, fontSize: 10 }}>
      {days === 0 ? 'today' : `${days}d ago`}
    </span>
  );
}

function toDays(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const days =
    typeof value === 'string' || value instanceof Date ? daysSince(value) : Number(value);
  if (!Number.isFinite(days) || days < 0) return null;
  return days;
}
