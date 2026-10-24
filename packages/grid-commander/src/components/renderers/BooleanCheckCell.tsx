import type { CellRendererProps } from '../../types/column';

export function BooleanCheckCell({ value }: CellRendererProps) {
  return (
    <span style={{ color: value ? 'var(--gc-green)' : 'var(--gc-red)' }}>
      {value ? '\u2713' : '\u2715'}
    </span>
  );
}
