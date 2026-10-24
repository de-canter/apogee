import type { CellRendererProps } from '../../types/column';
import { rec } from '../../utils/config';
import { textOf } from './text';

/** Text glyphs coloured by token; a host may pass `icons` to map its own vocabulary. */
const DEFAULT_ICONS: Record<string, { glyph: string; color: string }> = {
  urgent: { glyph: '●', color: 'var(--gc-red)' },
  high: { glyph: '●', color: 'var(--gc-orange)' },
  medium: { glyph: '●', color: 'var(--gc-yellow)' },
  low: { glyph: '○', color: 'var(--gc-text-muted)' },
  none: { glyph: '', color: 'inherit' },
};

export function PriorityIconCell({ value, config }: CellRendererProps) {
  const key = textOf(value).toLowerCase();
  const custom = rec(config, 'icons');
  if (custom) {
    const icon = custom[key];
    return <span style={{ fontSize: 10 }}>{typeof icon === 'string' ? icon : ''}</span>;
  }
  const icon = DEFAULT_ICONS[key];
  return (
    <span className="gc-cell-priority" style={{ fontSize: 10, color: icon?.color ?? 'inherit' }} title={key || undefined}>
      {icon?.glyph ?? ''}
    </span>
  );
}
