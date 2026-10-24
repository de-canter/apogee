import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CommandCockpit } from '../components/CommandCockpit';
import { filterFns, type DateRangeValue, type NumberRangeValue } from '../index';
import { localDayKey } from '../utils/dates';
import type { CommandColumnDef } from '../types/column';
import type { CockpitRef } from '../types/cockpit-ref';

interface Row { id: string; name: string }
const rows: Row[] = [{ id: '1', name: 'alpha' }, { id: '2', name: 'beta' }];
const editable: CommandColumnDef<Row>[] = [{ id: 'name', accessorKey: 'name', header: 'Name', editable: true, cellEditor: 'text-input' }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('editing inside a cockpit (review Critical 1, Important 1–2)', () => {
  it('Escape in a text editor cancels; the keyboard hook must not commit it through blur', () => {
    const onCellEdit = vi.fn();
    const ref = createRef<CockpitRef<Row>>();
    render(<CommandCockpit ref={ref} data={rows} columns={editable} getRowId={(r) => r.id} onCellEdit={onCellEdit} />);
    act(() => ref.current!.startEditing('1', 'name'));
    const input = screen.getByTestId<HTMLInputElement>('gc-editor-text-input');
    input.focus();
    fireEvent.change(input, { target: { value: 'changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCellEdit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gc-editor-text-input')).toBeNull();
  });
  it('stopEditing(false) followed by the unmount blur does not commit', () => {
    const onCellEdit = vi.fn();
    const ref = createRef<CockpitRef<Row>>();
    render(<CommandCockpit ref={ref} data={rows} columns={editable} getRowId={(r) => r.id} onCellEdit={onCellEdit} />);
    act(() => ref.current!.startEditing('1', 'name'));
    const input = screen.getByTestId<HTMLInputElement>('gc-editor-text-input');
    fireEvent.change(input, { target: { value: 'discard' } });
    act(() => {
      ref.current!.stopEditing(false);
      fireEvent.blur(input); // browsers blur a focused element on removal; jsdom does not, so we do
    });
    expect(onCellEdit).not.toHaveBeenCalled();
  });
  it('stopEditing(false) from a timer, then a late blur, still does not commit', () => {
    vi.useFakeTimers();
    const onCellEdit = vi.fn();
    const ref = createRef<CockpitRef<Row>>();
    render(<CommandCockpit ref={ref} data={rows} columns={editable} getRowId={(r) => r.id} onCellEdit={onCellEdit} />);
    act(() => ref.current!.startEditing('1', 'name'));
    const input = screen.getByTestId<HTMLInputElement>('gc-editor-text-input');
    fireEvent.change(input, { target: { value: 'discard' } });
    setTimeout(() => ref.current!.stopEditing(false), 0);
    act(() => {
      vi.runAllTimers();
    });
    fireEvent.blur(input);
    expect(onCellEdit).not.toHaveBeenCalled();
  });
});

describe('date-range filter on instants (review Important 3)', () => {
  const fake = (value: unknown) => ({ getValue: () => value }) as never;
  it('compares local calendar days for Date and ISO-instant inputs', () => {
    vi.stubEnv('TZ', 'America/Chicago');
    const localMidnightJan5 = new Date(2030, 0, 5);
    expect(localDayKey(localMidnightJan5)).toBe('2030-01-05');
    expect(filterFns.dateRange(fake(localMidnightJan5), 'd', { to: '2030-01-04' } satisfies DateRangeValue, () => undefined)).toBe(false);
    // 03:00Z on the 5th is the evening of the 4th in Chicago, which is the day the cell shows.
    expect(filterFns.dateRange(fake('2030-01-05T03:00:00Z'), 'd', { to: '2030-01-04' }, () => undefined)).toBe(true);
    expect(filterFns.numberRange(fake(3), 'n', { min: 1 } satisfies NumberRangeValue, () => undefined)).toBe(true);
  });
});

describe('countdown styling (review Important 4)', () => {
  it('ships a rule for every countdown variant', () => {
    const css = readFileSync(resolve(__dirname, '../themes/components.css'), 'utf8');
    for (const v of ['critical', 'warning', 'ok', 'done', 'none']) expect(css, v).toContain(`.gc-countdown--${v}`);
  });
});
