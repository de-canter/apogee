import { describe, it, expectTypeOf } from 'vitest';
import type { ActionContext, CellRendererProps, CockpitRef, CommandAction } from '../index';

type Row = { a: 1 };

describe('public types carry no any', () => {
  it('renderer value is unknown until narrowed', () => {
    expectTypeOf<CellRendererProps<Row>['value']>().toEqualTypeOf<unknown>();
    expectTypeOf<CellRendererProps<Row, string>['value']>().toEqualTypeOf<string>();
    expectTypeOf<CellRendererProps<Row>['config']>().toEqualTypeOf<Record<string, unknown>>();
  });
  it('cockpit ref is typed by the row', () => {
    expectTypeOf<CockpitRef<Row>['selectedRow']>().toEqualTypeOf<Row | null>();
    expectTypeOf<CockpitRef<Row>['getFilteredRows']>().returns.toEqualTypeOf<Row[]>();
  });
  it('action guards receive a typed context', () => {
    type Visible = NonNullable<CommandAction<Row>['visible']>;
    expectTypeOf<Parameters<Visible>[1]>().toEqualTypeOf<ActionContext<Row>>();
    expectTypeOf<ActionContext<Row>['selectedRows']>().toEqualTypeOf<Row[]>();
  });
});
