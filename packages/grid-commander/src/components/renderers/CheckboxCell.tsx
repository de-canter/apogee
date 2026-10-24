import { useRef, useEffect } from 'react';
import type { CellRendererProps } from '../../types/column';

/**
 * CheckboxCell renderer for row selection.
 *
 * Config props:
 * - isSelected: boolean — whether this row is selected
 * - isAllSelected: boolean — header: all rows selected
 * - isPartiallySelected: boolean — header: some rows selected
 * - onToggle: () => void — toggle this row
 * - onToggleAll: () => void — toggle all rows (header only)
 * - isHeader: boolean — whether this is the header checkbox
 */
export function CheckboxCell({ config }: CellRendererProps) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const isHeader = config.isHeader ?? false;
  const checked = isHeader ? config.isAllSelected : config.isSelected;
  const indeterminate = isHeader && config.isPartiallySelected;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = !!indeterminate;
    }
  }, [indeterminate]);

  return (
    <span className="gc-checkbox" onClick={(e) => e.stopPropagation()}>
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={!!checked}
        onChange={() => {
          if (isHeader) {
            config.onToggleAll?.();
          } else {
            config.onToggle?.();
          }
        }}
        className="gc-checkbox-input"
      />
    </span>
  );
}
