import type { CommandColumnDef } from '../types/column';
import { isDev } from './env';

export function validateColumnDefs<T>(columns: CommandColumnDef<T>[]): void {
  if (!isDev()) return;

  for (const col of columns) {
    if (!col.id) {
      console.warn('[GridCommander] Column is missing required "id" property:', col);
    }

    const colAny = col as unknown as { accessorKey?: unknown; accessorFn?: unknown };
    if (!colAny.accessorKey && !colAny.accessorFn) {
      console.warn(
        `[GridCommander] Column "${col.id}" has no accessorKey or accessorFn. It won't display data.`
      );
    }

    if (col.filterType === 'select' && (!col.filterOptions || col.filterOptions.length === 0)) {
      console.warn(
        `[GridCommander] Column "${col.id}" has filterType "select" but no filterOptions provided.`
      );
    }
  }
}
