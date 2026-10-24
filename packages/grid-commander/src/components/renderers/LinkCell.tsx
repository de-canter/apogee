import type { CellRendererProps } from '../../types/column';

/**
 * Link-styled cell. `config.onClick(value, row)` receives the row so a
 * consumer can open the file the cell belongs to, not just read its value.
 */
export function LinkCell({ value, row, config }: CellRendererProps) {
  const handleClick = () => {
    config.onClick?.(value, row);
  };

  return (
    <span className="gc-cell-link" onClick={handleClick}>
      {value}
    </span>
  );
}
