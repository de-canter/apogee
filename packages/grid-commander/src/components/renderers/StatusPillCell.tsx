import type { CellRendererProps } from '../../types/column';
import { fn, rec } from '../../utils/config';
import { asText, textOf } from './text';

interface Variant { label?: unknown; bg?: unknown; text?: unknown }

export function StatusPillCell({ value, row, config }: CellRendererProps) {
  const key = textOf(value);
  const getVariant = fn<(value: unknown) => Variant | undefined>(config, 'getVariant');
  if (getVariant) {
    const variant = getVariant(value) ?? {};
    const text = typeof variant.text === 'string' ? variant.text : 'var(--gc-text-muted)';
    const bg = typeof variant.bg === 'string' ? variant.bg : `${text}18`;
    return (
      <span className="gc-cell-pill" style={{ background: bg, color: text }}>
        {variant.label !== undefined ? asText(variant.label) : key}
      </span>
    );
  }

  const colorMap = rec(config, 'colorMap') ?? {};
  const entry = colorMap[key] ?? colorMap.default;
  let text = 'var(--gc-text-muted)';
  let bg: string | undefined;
  if (typeof entry === 'string') {
    text = entry;
    bg = `${entry}18`;
  } else if (entry && typeof entry === 'object') {
    const e = entry as { bg?: unknown; text?: unknown };
    if (typeof e.text === 'string') text = e.text;
    if (typeof e.bg === 'string') bg = e.bg;
  }
  const formatLabel = fn<(value: unknown, row: unknown) => unknown>(config, 'formatLabel');
  const label = formatLabel ? asText(formatLabel(value, row)) : key;
  return (
    <span className="gc-cell-pill" style={{ background: bg ?? `${text}18`, color: text }}>
      {label}
    </span>
  );
}
