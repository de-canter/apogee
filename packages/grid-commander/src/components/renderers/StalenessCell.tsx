import type { CellRendererProps } from '../../types/column';
import { daysSince } from '../../utils/dates';
import { num, str } from '../../utils/config';

/**
 * "today" / "Nd ago" with warning and critical colouring. A missing value, a non-number, or a negative
 * sentinel renders as an em dash, or as `config.emptyLabel` when the gap should read as a fact.
 */
export function StalenessCell({ value, config }: CellRendererProps) {
  const days = toDays(value);
  if (days === null) {
    const emptyLabel = str(config, 'emptyLabel');
    return (
      <span style={{ color: emptyLabel ? 'var(--gc-red)' : 'var(--gc-text-muted)', fontSize: 10 }}>
        {emptyLabel ?? '—'}
      </span>
    );
  }
  const criticalDays = num(config, 'criticalDays', 7);
  const warningDays = num(config, 'warningDays', 3);
  const color = days > criticalDays ? 'var(--gc-red)' : days > warningDays ? 'var(--gc-yellow)' : 'var(--gc-text-muted)';
  return <span style={{ color, fontSize: 10 }}>{days === 0 ? 'today' : `${days}d ago`}</span>;
}

function toDays(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const days = typeof value === 'string' || value instanceof Date ? daysSince(value, new Date()) : Number(value);
  if (!Number.isFinite(days) || days < 0) return null;
  return days;
}
