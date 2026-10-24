import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateColumnDefs } from '../utils/validation';
import type { CommandColumnDef } from '../types/column';

describe('validateColumnDefs', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('warns when column has no id', () => {
    validateColumnDefs([{ id: '', header: 'Test' } as CommandColumnDef<any>]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing required "id"'),
      expect.anything()
    );
  });

  it('warns when column has no accessorKey or accessorFn', () => {
    validateColumnDefs([{ id: 'test', header: 'Test' } as CommandColumnDef<any>]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no accessorKey or accessorFn')
    );
  });

  it('warns when select filter has no filterOptions', () => {
    validateColumnDefs([
      {
        id: 'test',
        accessorKey: 'test',
        header: 'Test',
        filterType: 'select',
      } as CommandColumnDef<any>,
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('filterType "select" but no filterOptions')
    );
  });

  it('does not warn for valid column definitions', () => {
    validateColumnDefs([
      {
        id: 'test',
        accessorKey: 'test',
        header: 'Test',
        filterType: 'text',
      } as CommandColumnDef<any>,
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
