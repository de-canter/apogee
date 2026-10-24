import { useEffect, useRef, useState } from 'react';
import type { CellEditorProps } from '../../types/editing';

const INPUT_STYLE: React.CSSProperties = {
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

export function TextInputEditor({ value, onCommit, onCancel }: CellEditorProps) {
  const [text, setText] = useState(value != null ? String(value) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
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
      style={INPUT_STYLE}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onCommit(text)}
      data-testid="gc-editor-text-input"
    />
  );
}
