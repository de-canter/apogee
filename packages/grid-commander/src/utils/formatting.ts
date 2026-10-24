export function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return '\u2014'; // em dash
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '\u2014';
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
