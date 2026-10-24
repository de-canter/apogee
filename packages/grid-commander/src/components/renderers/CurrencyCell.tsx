import type { CellRendererProps } from '../../types/column';
import { formatCurrency } from '../../utils/formatting';

/**
 * Money. `config.formatValue(value, row)` may return a word instead of a
 * figure — "Cash" in a loan column on a file with no lender — and `undefined`
 * to fall through to the normal currency format.
 */
export function CurrencyCell({ value, row, config }: CellRendererProps) {
  const custom = typeof config?.formatValue === 'function' ? config.formatValue(value, row) : undefined;
  return (
    <span className="gc-cell-currency">
      {custom !== undefined && custom !== null ? custom : formatCurrency(value)}
    </span>
  );
}
