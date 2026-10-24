import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TextInputEditor } from '../components/editors/TextInputEditor';
import { SelectEditor } from '../components/editors/SelectEditor';
import { DateEditor } from '../components/editors/DateEditor';
import { createEditorRegistry, builtInEditors, getEditor } from '../components/editors/registry';
import type { CellEditorProps } from '../types/editing';

const baseProps: Omit<CellEditorProps, 'onCommit' | 'onCancel'> = {
  value: 'test',
  row: {},
  config: {},
  columnId: 'col1',
};

describe('TextInputEditor', () => {
  it('renders with initial value and auto-focuses', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<TextInputEditor {...baseProps} onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByTestId<HTMLInputElement>('gc-editor-text-input');
    expect(input.value).toBe('test');
  });

  it('commits on Enter', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<TextInputEditor {...baseProps} onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByTestId('gc-editor-text-input');
    fireEvent.change(input, { target: { value: 'updated' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('updated');
  });

  it('cancels on Escape', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<TextInputEditor {...baseProps} onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByTestId('gc-editor-text-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits on blur', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<TextInputEditor {...baseProps} value="hello" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByTestId('gc-editor-text-input');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('hello');
  });
});

describe('SelectEditor', () => {
  it('commits on Enter and on blur, not on every change', () => {
    const onCommit = vi.fn();
    render(<DateEditor {...baseProps} value="2030-02-01" onCommit={onCommit} onCancel={vi.fn()} />);
    const input = screen.getByTestId<HTMLInputElement>('gc-editor-date');
    fireEvent.change(input, { target: { value: '2030-03-01' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('2030-03-01');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });;

  it('cancels on Escape', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const config = {
      options: [{ value: 'a', label: 'Option A' }],
    };
    render(
      <SelectEditor {...baseProps} config={config} onCommit={onCommit} onCancel={onCancel} />
    );
    const select = screen.getByTestId('gc-editor-select');
    fireEvent.keyDown(select, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('DateEditor', () => {
  it('commits on Enter and on blur, not on every change', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<DateEditor {...baseProps} value="2024-06-15" onCommit={onCommit} onCancel={onCancel} />);
    const input = screen.getByTestId<HTMLInputElement>('gc-editor-date');
    expect(input.value).toBe('2024-06-15');
    fireEvent.change(input, { target: { value: '2024-07-01' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('2024-07-01');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });;
});

describe('Editor Registry', () => {
  it('includes 3 built-in editors', () => {
    expect(Object.keys(builtInEditors)).toHaveLength(3);
    expect(builtInEditors['text-input']).toBeDefined();
    expect(builtInEditors['select']).toBeDefined();
    expect(builtInEditors['date']).toBeDefined();
  });

  it('createEditorRegistry merges custom editors', () => {
    const custom = { 'my-editor': vi.fn() };
    const registry = createEditorRegistry(custom);
    expect(registry['text-input']).toBeDefined();
    expect(registry['my-editor']).toBeDefined();
  });

  it('getEditor returns undefined for unknown name', () => {
    const registry = createEditorRegistry();
    const editor = getEditor(registry, 'nonexistent');
    expect(editor).toBeUndefined();
  });

  it('getEditor returns undefined for undefined name', () => {
    const registry = createEditorRegistry();
    const editor = getEditor(registry, undefined);
    expect(editor).toBeUndefined();
  });
});
