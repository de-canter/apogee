import type { CellRendererProps } from '../../types/column';

interface Threshold {
  max: number;
  color: string;
  display?: string;
}

export function CountBadgeCell({ value, row, config }: CellRendererProps) {
  const thresholds: Threshold[] = config.thresholds || [];
  const threshold = thresholds.find((t) => value <= t.max);
  const color = threshold?.color || 'var(--gc-text-muted)';

  if (value === 0 && threshold?.display) {
    return <span style={{ color }}>{threshold.display}</span>;
  }

  const hoverText =
    config.hoverContent && row[config.hoverContent]
      ? Array.isArray(row[config.hoverContent])
        ? row[config.hoverContent].join(', ')
        : String(row[config.hoverContent])
      : undefined;

  // formatValue(value, row) lets a column add units ("71%") or say something else
  // entirely for a row ("Funded") without losing the badge
  const display = config.formatValue ? config.formatValue(value, row) : value;

  return (
    <span
      className="gc-cell-badge"
      style={{
        background: `${color}22`,
        color,
      }}
      title={hoverText}
    >
      {display}
    </span>
  );
}
