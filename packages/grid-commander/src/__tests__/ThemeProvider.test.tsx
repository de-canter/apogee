import { render, screen } from '@testing-library/react';
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
