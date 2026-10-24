import type { CellRendererProps } from '../../types/column';
import { fn } from '../../utils/config';
import { asText } from './text';

/** Link-styled cell. `config.onClick(value, row)` receives the row so a consumer can open what the cell belongs to. */
export function LinkCell({ value, row, config }: CellRendererProps) {
  const onClick = fn<(value: unknown, row: unknown) => void>(config, 'onClick');
  return (
    <span className="gc-cell-link" onClick={() => onClick?.(value, row)}>
      {asText(value)}
    </span>
  );
}
