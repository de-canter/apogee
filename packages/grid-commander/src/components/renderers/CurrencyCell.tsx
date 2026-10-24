import type { CellRendererProps } from '../../types/column';
import { formatCurrency } from '../../utils/formatting';
import { fn } from '../../utils/config';
import { asText } from './text';

/** Money. `config.formatValue(value, row)` may return a word instead of a figure, or `undefined` to fall through. */
export function CurrencyCell({ value, row, config }: CellRendererProps) {
  const format = fn<(value: unknown, row: unknown) => unknown>(config, 'formatValue');
  const custom = format ? format(value, row) : undefined;
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? value : null;
  return (
    <span className="gc-cell-currency">
      {custom !== undefined && custom !== null ? asText(custom) : formatCurrency(amount)}
    </span>
  );
}
