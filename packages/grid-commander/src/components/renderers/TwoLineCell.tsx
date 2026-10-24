import type { CellRendererProps } from '../../types/column';

type LineSource<T> = string | ((row: T) => React.ReactNode) | undefined;

function resolveLine<T>(source: LineSource<T>, row: T, fallback: React.ReactNode): React.ReactNode {
  if (typeof source === 'function') return source(row);
  if (source) return (row as Record<string, unknown>)[source] as React.ReactNode;
  return fallback;
}

/**
 * Two-line cell: primary value on top, muted secondary line below.
 *
 * Each line can come from a field name or an accessor function. Both
 * `secondaryField` and `secondaryAccessor` (likewise `primaryField` /
 * `primaryAccessor`) are accepted; consumers have used both spellings.
 */
export function TwoLineCell({ value, row, config }: CellRendererProps) {
  const primary = resolveLine(config.primaryAccessor ?? config.primaryField, row, value);
  const secondary = resolveLine(config.secondaryAccessor ?? config.secondaryField, row, '');

  return (
    <div className="gc-cell-two-line">
      <div className="gc-cell-primary">{primary}</div>
      <div className="gc-cell-secondary" style={config.secondaryStyle}>
        {secondary}
      </div>
    </div>
  );
}
