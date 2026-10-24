import type { CellRendererProps } from '../../types/column';

export function BooleanCheckCell({ value }: CellRendererProps) {
  const on = Boolean(value);
  return <span style={{ color: on ? 'var(--gc-green)' : 'var(--gc-red)' }}>{on ? '✓' : '✕'}</span>;
}
