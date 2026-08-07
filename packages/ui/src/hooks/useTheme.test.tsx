import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './useTheme.js';

function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setTheme('light')}>light</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to system when nothing is stored', () => {
    render(
      <ThemeProvider storageKey="t">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });

  it('preserves an existing stored value as an explicit override', () => {
    // brand-web already persists 'dark' under ruostack_theme. Returning users
    // must not get a surprise theme flip when we move to a system default.
    localStorage.setItem('t', 'dark');
    render(
      <ThemeProvider storageKey="t">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('setTheme persists and flips the html class', () => {
    localStorage.setItem('t', 'dark');
    render(
      <ThemeProvider storageKey="t">
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText('light').click();
    });
    expect(localStorage.getItem('t')).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('throws a useful error when used outside the provider', () => {
    // React logs the error boundary trace; silence it for this one assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/must be used inside <ThemeProvider>/);
    spy.mockRestore();
  });
});
