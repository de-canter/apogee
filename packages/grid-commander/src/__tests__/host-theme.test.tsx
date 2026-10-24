import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../themes/ThemeProvider';
import { CommandCockpit } from '../components/CommandCockpit';

/** Review Focus 1: a host that owns the tokens on :root uses `inherit`; nothing in the tree re-declares them. */
describe('host-owned theme', () => {
  it('with mode="inherit" neither the provider nor the cockpit declares a theme class or inline tokens', () => {
    const style = document.createElement('style');
    style.textContent = ':root { --gc-accent: rgb(7, 8, 9); }';
    document.head.appendChild(style);
    try {
      const { container } = render(
        <ThemeProvider mode="inherit">
          <CommandCockpit data={[{ id: '1', name: 'A' }]} columns={[{ id: 'name', accessorKey: 'name', header: 'Name' }]} getRowId={(r) => r.id} />
        </ThemeProvider>
      );
      expect(container.querySelectorAll('.gc-theme-light, .gc-theme-dark')).toHaveLength(0);
      for (const el of Array.from(container.querySelectorAll<HTMLElement>('[style]'))) {
        expect(el.style.getPropertyValue('--gc-accent'), el.className).toBe('');
      }
      expect(container.querySelector('.gc-cockpit')).not.toBeNull();
    } finally {
      style.remove();
    }
  });
});
