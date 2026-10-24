import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const seen = vi.fn();
vi.mock('../components/ExportMenu', () => ({
  ExportMenu: (p: { filteredRows: unknown[] }) => {
    seen(p.filteredRows.length);
    return null;
  },
}));

import { CommandCockpit } from '../components/CommandCockpit';

interface Row { id: string; name: string }
const rows: Row[] = ['alpha', 'beta', 'gamma', 'delta', 'alphabet'].map((name, i) => ({ id: String(i), name }));

describe('export (Review Focus 3)', () => {
  it('the toolbar export receives the filtered rows, not every row', () => {
    render(
      <CommandCockpit
        data={rows}
        columns={[{ id: 'name', accessorKey: 'name', header: 'Name', filterType: 'text' }]}
        getRowId={(r) => r.id}
        defaultFilters={[{ id: 'name', value: 'alpha' }]}
        enableExport
        exportColumns={[{ id: 'name', header: 'Name' }]}
        title="t"
      />
    );
    expect(seen).toHaveBeenLastCalledWith(2);
  });
});
