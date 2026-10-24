import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandCockpit } from '../components/CommandCockpit';
import type { CommandColumnDef } from '../types/column';

interface TestRow {
  id: string;
  name: string;
  status: string;
}

const testData: TestRow[] = [
  { id: '1', name: 'Order A', status: 'Open' },
  { id: '2', name: 'Order B', status: 'Closed' },
  { id: '3', name: 'Order C', status: 'Open' },
];

const testColumns: CommandColumnDef<TestRow>[] = [
  { id: 'name', accessorKey: 'name', header: 'Name', filterType: 'text' },
  { id: 'status', accessorKey: 'status', header: 'Status', filterType: 'select', filterOptions: ['Open', 'Closed'] },
];

describe('CommandCockpit', () => {
  it('renders with light theme by default', () => {
    const { container } = render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
      />
    );
    expect(container.querySelector('.gc-theme-light')).not.toBeNull();
  });

  it('renders with dark theme', () => {
    const { container } = render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        theme="dark"
      />
    );
    expect(container.querySelector('.gc-theme-dark')).not.toBeNull();
  });

  it('wraps grid in cockpit container', () => {
    const { container } = render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
      />
    );
    expect(container.querySelector('.gc-cockpit')).not.toBeNull();
    expect(container.querySelector('.gc-grid')).not.toBeNull();
  });

  it('renders grid data', () => {
    render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
      />
    );
    expect(screen.getByText('Order A')).toBeInTheDocument();
    expect(screen.getByText('Order B')).toBeInTheDocument();
  });

  it('runs a grid-scoped consumer shortcut after a row is selected by click (#862)', () => {
    const handler = vi.fn();
    render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        keyboardShortcuts={[
          { key: 'w', description: 'Open workspace for selected file', scope: 'grid', handler },
        ]}
      />
    );

    // Clicking a row selects it and moves focus to the cockpit container.
    fireEvent.click(screen.getByText('Order B'));
    const focused = document.activeElement as HTMLElement;
    expect(focused.classList.contains('gc-cockpit')).toBe(true);

    fireEvent.keyDown(focused, { key: 'w' });

    expect(handler).toHaveBeenCalledTimes(1);
    const cockpit = handler.mock.calls[0][0];
    expect(cockpit.selectedRowId).toBe('2');
    expect(cockpit.selectedRow).toEqual(testData[1]);
  });

  it('calls onPersistState with debounce', async () => {
    vi.useFakeTimers();
    const onPersistState = vi.fn();
    render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        persistenceKey="test-cockpit"
        onPersistState={onPersistState}
      />
    );

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(onPersistState).toHaveBeenCalledWith(
      expect.objectContaining({
        columnOrder: ['name', 'status'],
        sorting: [],
        grouping: [],
        rowDensity: 'compact',
      })
    );

    vi.useRealTimers();
  });

  it('restores persisted state on mount', () => {
    render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        initialPersistedState={{
          columnOrder: ['status', 'name'],
          sorting: [{ id: 'name', desc: true }],
        }}
      />
    );
    // Grid renders — headers should appear
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('shows "N of M" in the toolbar once a preset narrows the rows (#909)', async () => {
    render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        title="Closing Pipeline"
        presets={[{ id: 'open', label: 'Open', filters: [{ id: 'status', value: 'Open' }] }]}
        initialPresetId="open"
      />
    );
    expect(await screen.findByText('2 of 3')).toBeInTheDocument();
  });

  it('shows the plain total when nothing is filtered', async () => {
    render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        title="Closing Pipeline"
      />
    );
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/of 3/)).toBeNull();
  });

  it('applies theme overrides', () => {
    const { container } = render(
      <CommandCockpit
        data={testData}
        columns={testColumns}
        getRowId={(r) => r.id}
        themeOverrides={{ '--gc-accent': '#ff0000' }}
      />
    );
    const themeWrapper = container.querySelector('.gc-theme-light') as HTMLElement;
    expect(themeWrapper.style.getPropertyValue('--gc-accent')).toBe('#ff0000');
  });
});
