import type { CellRendererProps } from '../../types/column';

export function StatusPillCell({ value, row, config }: CellRendererProps) {
  // getVariant computes label + colours per value in one place
  if (typeof config.getVariant === 'function') {
    const variant = config.getVariant(value) ?? {};
    const text = variant.text || 'var(--gc-text-muted)';
    return (
      <span
        className="gc-cell-pill"
        style={{ background: variant.bg || `${text}18`, color: text }}
      >
        {variant.label ?? value}
      </span>
    );
  }

  const colorEntry = config.colorMap?.[value] ?? config.colorMap?.default;
  // Support both flat string colors and { bg, text } objects
  const bg = typeof colorEntry === 'object' && colorEntry !== null
    ? colorEntry.bg
    : colorEntry ? `${colorEntry}18` : undefined;
  const text = typeof colorEntry === 'object' && colorEntry !== null
    ? colorEntry.text
    : colorEntry || 'var(--gc-text-muted)';

  // Support formatLabel for human-readable display of enum values
  const displayLabel = config.formatLabel ? config.formatLabel(value, row) : value;

  return (
    <span
      className="gc-cell-pill"
      style={{
        background: bg || `${text}18`,
        color: text,
      }}
    >
      {displayLabel}
    </span>
  );
}
