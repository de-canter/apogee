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

/**
 * Where the grid's "today" comes from. Real time by default; an application
 * whose business day differs from the wall clock (a demo or test clock)
 * registers its own with `setGridClock`, so every countdown, "x d late" and
 * staleness cell agrees with the rest of the app instead of the browser.
 */
let gridClock: () => Date = () => new Date();

/** Register the grid's "today" (pass null to restore real time). */
export function setGridClock(clock: (() => Date) | null): void {
  gridClock = clock ?? (() => new Date());
}

/** The grid's current "today". */
export function gridNow(): Date {
  return gridClock();
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysUntil(value: string | Date | number, now: Date = gridNow()): number {
  const target = startOfDay(toDate(value));
  const today = startOfDay(now);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

export function daysSince(value: string | Date | number, now: Date = gridNow()): number {
  const target = startOfDay(toDate(value));
  const today = startOfDay(now);
  return Math.round((today.getTime() - target.getTime()) / MS_PER_DAY);
}

export function isToday(value: string | Date | number, now: Date = gridNow()): boolean {
  return daysUntil(value, now) === 0;
}

export function formatDate(value: string | Date | number): string {
  const date = toDate(value);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear().toString().slice(2);
  return `${month}/${day}/${year}`;
}
