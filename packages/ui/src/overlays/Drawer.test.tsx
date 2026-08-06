import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from './Drawer.js';

/* Regression coverage for the hand-rolled Drawer this replaces
 * (admin-web/src/components/ui.tsx). That one rendered a plain div with an
 * onClick backdrop: no dialog role, no focus trap, no Escape handling, and no
 * focus restoration. Each case below is one of those defects. */
describe('Drawer', () => {
  it('exposes a labelled dialog when open', () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Order detail">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Order detail' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Drawer open={false} onOpenChange={() => {}} title="Order detail">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer open onOpenChange={onOpenChange} title="Order detail">
        <p>body</p>
      </Drawer>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('moves focus into the dialog', () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Order detail">
        <button>Inside</button>
      </Drawer>,
    );
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('has an accessible close control', () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Order detail">
        <p>body</p>
      </Drawer>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
