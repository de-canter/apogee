import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandCockpit } from '../components/CommandCockpit';
import type { CommandColumnDef } from '../types/column';
import type { FilterPreset } from '../types/toolbar';

interface TestRow {
  id: string;
  name: string;
  status: string;
}

const columns: CommandColumnDef<TestRow>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name' },
  { id: 'status', accessorKey: 'status', header: 'Status', filterType: 'select', filterOptions: ['open', 'closed'] },
];

const data: TestRow[] = [
  { id: '1', name: 'Alpha', status: 'open' },
  { id: '2', name: 'Beta', status: 'closed' },
];

const presets: FilterPreset[] = [
  { id: 'open', label: 'Open', filters: [{ id: 'status', value: 'open' }] },
  { id: 'closed', label: 'Closed', filters: [{ id: 'status', value: 'closed' }] },
];

describe('CommandCockpit presets — onPresetChange', () => {
  it('reports the preset id when a pill is applied and null when it is toggled off', () => {
    const onPresetChange = vi.fn();
    render(
      <CommandCockpit<TestRow>
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        presets={presets}
        initialPresetId="open"
        onPresetChange={onPresetChange}
      />
    );

    fireEvent.click(screen.getByText('Closed'));
    expect(onPresetChange).toHaveBeenLastCalledWith('closed');

    fireEvent.click(screen.getByText('Closed'));
    expect(onPresetChange).toHaveBeenLastCalledWith(null);
  });
});
