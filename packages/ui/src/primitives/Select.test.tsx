import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select.js';

// Radix Select drives its listbox with pointer capture, scroll-into-view and a
// ResizeObserver — none of which jsdom implements. Stubbed here rather than in
// the shared setup so only this file pays for them.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** Long enough to run past the bottom of any viewport. */
const OPTIONS = Array.from({ length: 40 }, (_, i) => ({ value: `p${i}`, label: `Peptide ${i}` }));

const AVAILABLE_HEIGHT = 'max-h-[var(--radix-select-content-available-height)]';

describe('Select', () => {
  it('opens to show its options', async () => {
    render(<Select options={OPTIONS} value="" onValueChange={() => {}} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Peptide 0')).toBeInTheDocument();
  });

  /**
   * The listbox must be bounded by the space actually on screen. Radix already
   * sets `overflow: hidden auto` on its viewport inline, so scrolling is not the
   * missing piece — a height bound is. Without one the content simply grows to
   * fit all 40 options and runs off the bottom of the screen, unreachable.
   */
  it('bounds the open listbox to the available screen height', async () => {
    render(<Select options={OPTIONS} value="" onValueChange={() => {}} />);
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByText('Peptide 0');

    const bounded = document.querySelector(`[class*="${AVAILABLE_HEIGHT}"]`);
    expect(bounded).not.toBeNull();
  });
});
