export interface SummaryChipProps {
  label: string;
  value: string | number;
  color?: string;
}

export function SummaryChip({ label, value, color }: SummaryChipProps) {
  return (
    <span
      className="gc-summary-chip"
      style={color ? { borderColor: color, color } : undefined}
    >
      <span className="gc-summary-chip-label">{label}:</span>
      <span className="gc-summary-chip-value">{value}</span>
    </span>
  );
}
