import { render, screen } from '@testing-library/react';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { ThemeProvider } from '../themes/ThemeProvider';

describe('ThemeProvider', () => {
  it('renders children', () => {
    render(
      <ThemeProvider>
        <div data-testid="child">Hello</div>
      </ThemeProvider>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('applies light theme class by default', () => {
    const { container } = render(
      <ThemeProvider>
        <span>test</span>
      </ThemeProvider>
    );
    expect(container.firstElementChild).toHaveClass('gc-theme-light');
  });

  it('applies dark theme class', () => {
    const { container } = render(
      <ThemeProvider theme="dark">
        <span>test</span>
      </ThemeProvider>
    );
    expect(container.firstElementChild).toHaveClass('gc-theme-dark');
  });

  it('merges theme overrides as inline styles', () => {
    const { container } = render(
      <ThemeProvider themeOverrides={{ '--gc-accent': '#ff0000' }}>
        <span>test</span>
      </ThemeProvider>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue('--gc-accent')).toBe('#ff0000');
  });
});

describe('ThemeProvider nesting and inherit mode (review fix: host tokens win)', () => {
  it('a nested provider renders no theme class and no inline tokens', () => {
    const { container } = render(
      <ThemeProvider themeOverrides={{ '--gc-accent': 'rgb(1, 2, 3)' }}>
        <ThemeProvider theme="dark" themeOverrides={{ '--gc-accent': 'rgb(9, 9, 9)' }}>
          <span data-testid="leaf">x</span>
        </ThemeProvider>
      </ThemeProvider>
    );
    expect(container.querySelectorAll('.gc-theme-light, .gc-theme-dark')).toHaveLength(1);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toHaveClass('gc-theme-light');
    expect(outer.style.getPropertyValue('--gc-accent')).toBe('rgb(1, 2, 3)');
    const inner = screen.getByTestId('leaf').parentElement as HTMLElement;
    expect(inner).not.toBe(outer);
    expect(inner.className).toBe('');
    expect(inner.style.getPropertyValue('--gc-accent')).toBe('');
  });

  it('mode="inherit" declares nothing, so a host that owns --gc-* on :root is untouched', () => {
    const { container } = render(
      <ThemeProvider mode="inherit" themeOverrides={{ '--gc-accent': 'rgb(1, 2, 3)' }}>
        <span>test</span>
      </ThemeProvider>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toBe('');
    expect(wrapper.style.getPropertyValue('--gc-accent')).toBe('');
  });

  it('a cockpit inside a host provider does not re-declare the theme (structural: jsdom cannot compute inherited custom properties)', async () => {
    const { CommandCockpit } = await import('../components/CommandCockpit');
    const { container } = render(
      <ThemeProvider themeOverrides={{ '--gc-accent': 'rgb(1, 2, 3)' }}>
        <CommandCockpit
          data={[{ id: '1', name: 'A' }]}
          columns={[{ id: 'name', accessorKey: 'name', header: 'Name' }]}
          getRowId={(r) => r.id}
        />
      </ThemeProvider>
    );
    const themed = container.querySelectorAll('.gc-theme-light, .gc-theme-dark');
    expect(themed).toHaveLength(1);
    expect((themed[0] as HTMLElement).style.getPropertyValue('--gc-accent')).toBe('rgb(1, 2, 3)');
    expect(container.querySelector('.gc-cockpit')?.closest('.gc-theme-light')).toBe(themed[0]);
  });

  it('styles.css bundles the four sheets in order', () => {
    const themes = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes');
    const css = readFileSync(join(themes, 'styles.css'), 'utf8');
    const imports = [...css.matchAll(/@import '\.\/([a-z]+\.css)';/g)].map((m) => m[1]);
    expect(imports).toEqual(['variables.css', 'light.css', 'dark.css', 'components.css']);
    for (const f of imports) expect(existsSync(join(themes, f!)), f).toBe(true);
    expect(readFileSync(join(themes, 'components.css'), 'utf8')).toContain('.gc-cockpit');
  });
});
