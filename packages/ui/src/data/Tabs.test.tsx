import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs.js';

const tabs = [
  { key: 'all' as const, label: 'All', count: 12 },
  { key: 'shipped' as const, label: 'Shipped', count: 3 },
];

describe('Tabs', () => {
  it('marks the active tab with aria-selected', () => {
    render(<Tabs tabs={tabs} active="all" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Shipped/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the tab key', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: /Shipped/ }));
    expect(onChange).toHaveBeenCalledWith('shipped');
  });

  it('scrolls horizontally rather than wrapping on narrow viewports', () => {
    // Wrapping filter chips push page content down and cause layout jumps on
    // phones; a single scrolling row keeps the table position stable.
    render(<Tabs tabs={tabs} active="all" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).toHaveClass('overflow-x-auto');
  });
});
