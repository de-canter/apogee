import type { CellRendererProps } from '../../types/column';
import { fn } from '../../utils/config';
import { textOf } from './text';

export function TextCell({ value, config }: CellRendererProps) {
  const raw = textOf(value);
  const format = fn<(raw: string) => string>(config, 'formatValue');
  const display = format ? format(raw) : raw;
  return (
    <span className="gc-cell-text" title={display}>
      {display}
    </span>
  );
}
