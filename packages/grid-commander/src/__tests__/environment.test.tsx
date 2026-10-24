import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandCockpit } from '../components/CommandCockpit';
import { useCockpitEnvironment } from '../environment';
import type { CommandColumnDef } from '../types/column';

interface Row { id: string; due: string; seen: string; amount: number }
const rows: Row[] = [{ id: '1', due: '2030-01-04', seen: '2029-12-25', amount: 1234.5 }];
const columns: CommandColumnDef<Row>[] = [
  { id: 'due', accessorKey: 'due', header: 'Due', cellRenderer: 'deadline', cellConfig: { showCountdown: true } },
  { id: 'seen', accessorKey: 'seen', header: 'Seen', cellRenderer: 'staleness' },
  { id: 'amount', accessorKey: 'amount', header: 'Amount', cellRenderer: 'currency' },
];

describe('CockpitEnvironment', () => {
  it('defaults outside a cockpit', () => {
    let env: ReturnType<typeof useCockpitEnvironment> | undefined;
    function Probe() {
      env = useCockpitEnvironment();
      return null;
    }
    render(<Probe />);
    expect(env?.locale).toBe('en-US');
    expect(env?.currency).toBe('USD');
    expect(Math.abs(env!.now().getTime() - Date.now())).toBeLessThan(5000);
  });

  it('a frozen now reaches deadline and staleness cells; locale and currency reach currency cells', () => {
    render(
      <CommandCockpit
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        now={() => new Date(2030, 0, 1, 12, 0)}
        locale="de-DE"
        currency="EUR"
      />
    );
    expect(screen.getByText('3d')).toBeInTheDocument();
    expect(screen.getByText('7d ago')).toBeInTheDocument();
    expect(screen.getByText(/€/)).toBeInTheDocument();
  });
});
