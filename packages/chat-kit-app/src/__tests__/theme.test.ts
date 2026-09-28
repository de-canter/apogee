import { describe, expect, it } from 'vitest';
import { applyTheme, defaultThemeMap } from '../theme';

describe('applyTheme', () => {
  it('applies the document theme, host variables, and the map', () => {
    applyTheme({ theme: 'dark', styles: { variables: { '--color-background-primary': '#000', '--color-text-primary': '#fff' } as never } }, defaultThemeMap);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--ck-surface')).toBe('#000');
    expect(root.style.getPropertyValue('--ck-text')).toBe('#fff');
    expect(root.style.getPropertyValue('--color-background-primary')).toBe('#000');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });
  it('skips undefined values and accepts a custom map', () => {
    document.documentElement.style.removeProperty('--brand');
    applyTheme({ theme: 'light' }, { '--brand': (h) => (h.theme === 'light' ? 'wine' : undefined), '--none': () => undefined });
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('wine');
    expect(document.documentElement.style.getPropertyValue('--none')).toBe('');
  });
});
