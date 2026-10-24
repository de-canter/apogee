import type { CellRendererProps } from '../../types/column';
import { arr, fn, str } from '../../utils/config';
import { asRecord, asText, textOf } from './text';

interface Threshold { max: number; color: string; display?: string }

export function CountBadgeCell({ value, row, config }: CellRendererProps) {
  const count = typeof value === 'number' ? value : Number(value ?? 0);
  const thresholds = arr<Threshold>(config, 'thresholds') ?? [];
  const threshold = thresholds.find((t) => count <= t.max);
  const color = threshold?.color ?? 'var(--gc-text-muted)';

  if (count === 0 && threshold?.display) return <span style={{ color }}>{threshold.display}</span>;

  const hoverField = str(config, 'hoverContent');
  const hover = hoverField ? asRecord(row)[hoverField] : undefined;
  const hoverText = Array.isArray(hover) ? hover.map(textOf).join(', ') : hover ? textOf(hover) : undefined;

  // formatValue(value, row) lets a column add units or a word for a row without losing the badge.
  const format = fn<(value: unknown, row: unknown) => unknown>(config, 'formatValue');
  const display = format ? asText(format(value, row)) : count;

  return (
    <span className="gc-cell-badge" style={{ background: `${color}22`, color }} title={hoverText}>
      {display}
    </span>
  );
}
