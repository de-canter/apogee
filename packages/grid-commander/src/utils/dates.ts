const MS_PER_DAY = 86_400_000;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A YYYY-MM-DD string is a calendar day, not an instant: `new Date('2026-09-29')`
 * is UTC midnight, which every zone west of UTC renders as the 28th. Read it as
 * local midnight of that day so the cell shows the day the API sent.
 */
function toDate(value: string | Date | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Whole days from `now`'s day to the value's day. `now` is the cockpit environment's clock, never the module's. */
export function daysUntil(value: string | Date | number, now: Date): number {
  const target = startOfDay(toDate(value));
  const today = startOfDay(now);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

export function daysSince(value: string | Date | number, now: Date): number {
  const target = startOfDay(toDate(value));
  const today = startOfDay(now);
  return Math.round((today.getTime() - target.getTime()) / MS_PER_DAY);
}

export function isToday(value: string | Date | number, now: Date): boolean {
  return daysUntil(value, now) === 0;
}

export interface DateFormat {
  locale?: string | undefined;
}

/** A calendar date for display: `MM/DD/YY` in the default en-US, the locale's short form otherwise. */
export function formatDate(value: string | Date | number, opts: DateFormat = {}): string {
  const date = toDate(value);
  const locale = opts.locale ?? 'en-US';
  if (locale === 'en-US') {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(2);
    return `${month}/${day}/${year}`;
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
