import type { ReactNode } from 'react';
import type { CellRendererProps } from '../../types/column';
import { asRecord, asText } from './text';

type LineSource = string | ((row: unknown) => ReactNode) | undefined;

/** Both spellings accept either a field name or an accessor; consumers have used both. */
function lineSource(config: Record<string, unknown>, accessorKey: string, fieldKey: string): LineSource {
  for (const v of [config[accessorKey], config[fieldKey]]) {
    if (typeof v === 'function') return v as (row: unknown) => ReactNode;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function resolveLine(source: LineSource, row: unknown, fallback: ReactNode): ReactNode {
  if (typeof source === 'function') return source(row);
  if (source) return asText(asRecord(row)[source]);
  return fallback;
}

/**
 * Two-line cell: primary value on top, muted secondary line below. Each line comes from a field name
 * (`primaryField` / `secondaryField`) or an accessor (`primaryAccessor` / `secondaryAccessor`).
 */
export function TwoLineCell({ value, row, config }: CellRendererProps) {
  const primary = resolveLine(lineSource(config, 'primaryAccessor', 'primaryField'), row, asText(value));
  const secondary = resolveLine(lineSource(config, 'secondaryAccessor', 'secondaryField'), row, '');
  const secondaryStyle = config.secondaryStyle as React.CSSProperties | undefined;
  return (
    <div className="gc-cell-two-line">
      <div className="gc-cell-primary">{primary}</div>
      <div className="gc-cell-secondary" style={secondaryStyle}>
        {secondary}
      </div>
    </div>
  );
}
