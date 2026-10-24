import { useEffect, useRef } from 'react';
import type { CellEditorProps } from '../../types/editing';

const DATE_STYLE: React.CSSProperties = {
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

function toDateValue(val: any): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export function DateEditor({ value, onCommit, onCancel }: CellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onCommit(inputRef.current?.value || '');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="date"
      style={DATE_STYLE}
      defaultValue={toDateValue(value)}
      onChange={(e) => onCommit(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCancel()}
      data-testid="gc-editor-date"
    />
  );
}
