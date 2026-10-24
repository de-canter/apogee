import { useEffect, useRef } from 'react';
import type { CellEditorProps } from '../../types/editing';

const SELECT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '2px 4px',
  border: '1px solid var(--gc-accent, #3b82f6)',
  borderRadius: 2,
  outline: 'none',
  fontFamily: 'var(--gc-font-body, inherit)',
  fontSize: 12,
  lineHeight: 1.4,
  background: 'var(--gc-bg, #fff)',
  color: 'var(--gc-text, #1f2937)',
  boxSizing: 'border-box' as const,
};

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectEditor({ value, config, onCommit, onCancel }: CellEditorProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const options: SelectOption[] = config.options || [];

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <select
      ref={selectRef}
      style={SELECT_STYLE}
      value={value ?? ''}
      onChange={(e) => onCommit(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCancel()}
      data-testid="gc-editor-select"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
