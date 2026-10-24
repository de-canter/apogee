import type { CellRendererProps } from '../../types/column';
import { rec, str } from '../../utils/config';
import { asRecord, textOf } from './text';

type Variant = 'critical' | 'warning' | 'ok' | 'done' | 'none';
const VARIANTS: readonly Variant[] = ['critical', 'warning', 'ok', 'done', 'none'];

/**
 * A countdown driven by numbers the host already published (`daysField`), never by a date the cell
 * would have to interpret, so the server's business-day arithmetic is what the user sees. The colour
 * comes from `variantField` through `variants`, or from day thresholds when no variant is given.
 */
export function CountdownCell({ row, config }: CellRendererProps) {
  const data = asRecord(row);
  const daysField = str(config, 'daysField', 'days');
  const raw = data[daysField];
  const days = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

  let variant: Variant | undefined;
  const variantField = str(config, 'variantField');
  if (variantField) {
    const map = rec(config, 'variants') ?? {};
    const key = textOf(data[variantField]);
    const v = map[key];
    if (typeof v === 'string' && (VARIANTS as readonly string[]).includes(v)) variant = v as Variant;
  }
  if (!variant) {
    variant = days === null ? 'none' : days <= 0 ? 'critical' : days <= 3 ? 'warning' : 'ok';
  }

  const labels = rec(config, 'labels') ?? {};
  const word = (k: string, fallback: string) => (typeof labels[k] === 'string' ? (labels[k]) : fallback);
  let text: string;
  if (variant === 'done') text = str(config, 'doneLabel', 'Done');
  else if (days === null) text = '—';
  else if (days < 0) text = `${-days}d ${word('overdue', 'overdue')}`;
  else if (days === 0) text = word('today', 'Today');
  else text = `${days}d${word('until', '') ? ` ${word('until', '')}` : ''}`;

  return (
    <span className={`gc-countdown gc-countdown--${variant}`} data-days={days ?? undefined}>
      {text}
    </span>
  );
}
