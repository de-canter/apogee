import type { CellRendererProps } from '../../types/column';

export function TextCell({ value, config }: CellRendererProps) {
  const raw = value != null ? String(value) : '';
  const display = config?.formatValue ? config.formatValue(raw) : raw;
  return (
    <span className="gc-cell-text" title={display}>
      {display}
    </span>
  );
}
