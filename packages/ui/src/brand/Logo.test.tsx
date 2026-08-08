import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo } from './Logo.js';

describe('Logo', () => {
  it('exposes an accessible name', () => {
    render(<Logo />);
    expect(screen.getByRole('img', { name: 'RUOStack' })).toBeInTheDocument();
  });

  it('inherits colour via currentColor so it themes from one definition', () => {
    render(<Logo />);
    expect(screen.getByRole('img', { name: 'RUOStack' })).toHaveAttribute('fill', 'currentColor');
  });

  it('renders one path per bar of the stack', () => {
    const { container } = render(<Logo />);
    expect(container.querySelectorAll('path')).toHaveLength(3);
  });

  it('knocks the vials out of every bar with the even-odd fill rule', () => {
    /* Regression guard. Each bar is a single path whose subpaths are the three
     * vials. Under the default `nonzero` rule those subpaths fill solid rather
     * than knocking out, and the mark renders as three blank bars — valid SVG,
     * wrong logo, and invisible to typecheck and to the build. */
    const { container } = render(<Logo />);
    const paths = [...container.querySelectorAll('path')];
    expect(paths).not.toHaveLength(0);
    for (const path of paths) {
      expect(path.getAttribute('fill-rule')).toBe('evenodd');
    }
  });

  it('carries three vials per bar', () => {
    // Each vial is two subpaths (cap + body), so 1 outer bar + 3 x 2 = 7 `M`s.
    const { container } = render(<Logo />);
    for (const path of container.querySelectorAll('path')) {
      const subpaths = (path.getAttribute('d') ?? '').split('M').filter((s) => s.trim()).length;
      expect(subpaths).toBe(7);
    }
  });

  it('does not force a square aspect, since the mark is 154x142', () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('-2 -2 154 142');
    expect(svg.getAttribute('class')).toContain('w-auto');
  });

  it('renders the wordmark alongside the mark in the full variant', () => {
    render(<Logo variant="full" />);
    expect(screen.getByText('RUOStack')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'RUOStack' })).toBeInTheDocument();
  });
});
