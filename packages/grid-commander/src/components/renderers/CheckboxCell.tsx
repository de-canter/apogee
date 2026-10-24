import { useRef, useEffect } from 'react';
import type { CellRendererProps } from '../../types/column';
import { bool, fn } from '../../utils/config';

/**
 * Row-selection checkbox. Config: isSelected, isAllSelected, isPartiallySelected, onToggle, onToggleAll, isHeader.
 */
export function CheckboxCell({ config }: CellRendererProps) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const isHeader = bool(config, 'isHeader');
  const checked = isHeader ? bool(config, 'isAllSelected') : bool(config, 'isSelected');
  const indeterminate = isHeader && bool(config, 'isPartiallySelected');
  const onToggle = fn<() => void>(config, 'onToggle');
  const onToggleAll = fn<() => void>(config, 'onToggleAll');

  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <span className="gc-checkbox" onClick={(e) => e.stopPropagation()}>
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={checked}
        onChange={() => (isHeader ? onToggleAll?.() : onToggle?.())}
        className="gc-checkbox-input"
      />
    </span>
  );
}
