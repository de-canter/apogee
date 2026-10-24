export interface MoneyFormat {
  locale?: string | undefined;
  currency?: string | undefined;
  minimumFractionDigits?: number | undefined;
}

/** Money for display. Defaults to en-US / USD; a cockpit passes its environment's locale and currency. */
export function formatCurrency(value: number | string | null | undefined, opts: MoneyFormat = {}): string {
  if (value == null) return '\u2014';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '\u2014';
  return new Intl.NumberFormat(opts.locale ?? 'en-US', {
    style: 'currency',
    currency: opts.currency ?? 'USD',
    minimumFractionDigits: opts.minimumFractionDigits ?? 2,
    maximumFractionDigits: 2,
  }).format(num);
}
