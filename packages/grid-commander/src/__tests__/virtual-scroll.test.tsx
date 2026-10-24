import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { createRef } from 'react';

const scrollToIndex = vi.fn();
vi.mock('@tanstack/react-virtual', async (orig) => {
  const m = await orig<typeof import('@tanstack/react-virtual')>();
  return {
    ...m,
    useVirtualizer: (o: Parameters<typeof m.useVirtualizer>[0]) => {
      const v = m.useVirtualizer(o);
      v.scrollToIndex = scrollToIndex;
      return v;
    },
  };
});

import { CommandCockpit } from '../components/CommandCockpit';
import type { CockpitRef } from '../types/cockpit-ref';

interface Row { id: string; name: string }

describe('virtualised keyboard navigation (Review Focus 5)', () => {
  it('navigating past the rendered window scrolls the selected index into view', () => {
    const many: Row[] = Array.from({ length: 300 }, (_, i) => ({ id: String(i), name: `r${i}` }));
    const ref = createRef<CockpitRef<Row>>();
    render(
      <CommandCockpit ref={ref} data={many} columns={[{ id: 'name', accessorKey: 'name', header: 'Name' }]} getRowId={(r) => r.id} enableVirtualization />
    );
    act(() => ref.current!.selectRow('40'));
    act(() => ref.current!.navigateRow('next'));
    expect(ref.current!.selectedRowId).toBe('41');
    expect(scrollToIndex).toHaveBeenCalledWith(41, expect.anything());
  });
});
