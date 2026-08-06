import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>New order</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'New order' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses the solid accent for the primary variant', () => {
    // --accent-solid is the only accent value that carries a white label at AA.
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-accent-solid');
  });

  it('is disabled and announces busy while loading', () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('does not fire onClick while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('meets the 44px mobile tap target', () => {
    render(<Button>Tap</Button>);
    expect(screen.getByRole('button')).toHaveClass('min-h-11');
  });
});
