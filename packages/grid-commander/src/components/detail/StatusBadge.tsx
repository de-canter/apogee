export interface StatusBadgeProps {
  text: string | number;
  color?: string | undefined;
  backgroundColor?: string | undefined;
}

export function StatusBadge({ text, color, backgroundColor }: StatusBadgeProps) {
  return (
    <span
      className="gc-status-badge"
      style={{
        color: color ?? 'var(--gc-text)',
        backgroundColor: backgroundColor ?? 'var(--gc-bg-section)',
      }}
    >
      {text}
    </span>
  );
}
