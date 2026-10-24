import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStickyColumns } from '../hooks/useStickyColumns';
import type { CommandColumnDef } from '../types/column';

interface TestRow {
  id: string;
  name: string;
  email: string;
  status: string;
}

const testColumns: CommandColumnDef<TestRow>[] = [
  { id: 'id', header: 'ID', size: 60 },
  { id: 'name', header: 'Name', size: 200 },
  { id: 'email', header: 'Email', size: 250 },
  { id: 'status', header: 'Status', size: 100 },
];

describe('useStickyColumns', () => {
  it('returns no styles when no pinned columns', () => {
    const { result } = renderHook(() =>
      useStickyColumns(undefined, testColumns, {})
    );
    expect(result.current.hasStickyColumns).toBe(false);
    expect(result.current.getColumnStyle('id')).toEqual({});
    expect(result.current.getColumnClass('id')).toBe('');
  });

  it('returns hasStickyColumns false when config is empty', () => {
    const { result } = renderHook(() =>
      useStickyColumns({ pinnedLeft: [], pinnedRight: [] }, testColumns, {})
    );
    expect(result.current.hasStickyColumns).toBe(false);
  });

  it('returns hasStickyColumns true when columns are pinned', () => {
    const { result } = renderHook(() =>
      useStickyColumns({ pinnedLeft: ['id'] }, testColumns, {})
    );
    expect(result.current.hasStickyColumns).toBe(true);
  });

  it('left-pinned columns get position:sticky and left offset', () => {
    const { result } = renderHook(() =>
      useStickyColumns({ pinnedLeft: ['id'] }, testColumns, {})
    );
    const style = result.current.getColumnStyle('id');
    expect(style.position).toBe('sticky');
    expect(style.left).toBe(0);
    expect(style.zIndex).toBe(2);
    expect(result.current.getColumnClass('id')).toBe('gc-grid-cell--pinned-left');
  });

  it('right-pinned columns get position:sticky and right offset', () => {
    const { result } = renderHook(() =>
      useStickyColumns({ pinnedRight: ['status'] }, testColumns, {})
    );
    const style = result.current.getColumnStyle('status');
    expect(style.position).toBe('sticky');
    expect(style.right).toBe(0);
    expect(style.zIndex).toBe(2);
    expect(result.current.getColumnClass('status')).toBe('gc-grid-cell--pinned-right');
  });

  it('multiple left-pinned columns have cumulative offsets', () => {
    const { result } = renderHook(() =>
      useStickyColumns({ pinnedLeft: ['id', 'name'] }, testColumns, {})
    );
    // id: size=60, starts at left=0
    expect(result.current.getColumnStyle('id').left).toBe(0);
    // name: starts after id (60px)
    expect(result.current.getColumnStyle('name').left).toBe(60);
  });

  it('uses columnSizing state over column def size', () => {
    const { result } = renderHook(() =>
      useStickyColumns(
        { pinnedLeft: ['id', 'name'] },
        testColumns,
        { id: 80 } // Override id width
      )
    );
    expect(result.current.getColumnStyle('id').left).toBe(0);
    // name starts after id at 80px (from sizing state)
    expect(result.current.getColumnStyle('name').left).toBe(80);
  });
});
