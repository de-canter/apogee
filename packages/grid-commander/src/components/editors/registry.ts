import type { CellEditorFn, CellEditorRegistry } from '../../types/editing';
import { TextInputEditor } from './TextInputEditor';
import { SelectEditor } from './SelectEditor';
import { DateEditor } from './DateEditor';

export const builtInEditors: CellEditorRegistry = {
  'text-input': TextInputEditor,
  select: SelectEditor,
  date: DateEditor,
};

export function createEditorRegistry(
  customEditors?: CellEditorRegistry
): CellEditorRegistry {
  return { ...builtInEditors, ...customEditors };
}

export function getEditor(
  registry: CellEditorRegistry,
  name: string | undefined
): CellEditorFn | undefined {
  if (!name) return undefined;
  const editor = registry[name];
  if (!editor) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[GridCommander] Unknown cell editor "${name}", no editor available.`);
    }
    return undefined;
  }
  return editor;
}
