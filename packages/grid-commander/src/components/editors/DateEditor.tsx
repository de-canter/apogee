import { useEffect, useRef, useState } from 'react';
import { localDayKey } from '../../utils/dates';
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

/** The input's YYYY-MM-DD, taken as a local date: no UTC conversion that could shift the day. */
function toDateValue(val: unknown): string {
  if (typeof val === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(val);
    if (m) return m[1]!;
    const d = new Date(val);
    return isNaN(d.getTime()) ? '' : localDayKey(d);
  }
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : localDayKey(val);
  if (typeof val === 'number') return localDayKey(new Date(val));
  return '';
}

export function DateEditor({ value, onCommit, onCancel }: CellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => toDateValue(value));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onCommit(text);
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
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCommit(text)}
      data-testid="gc-editor-date"
    />
  );
}
