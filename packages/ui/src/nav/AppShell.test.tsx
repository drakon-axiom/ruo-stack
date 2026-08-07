import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { LayoutDashboard, Package, Wallet, Store } from '../icons.js';

const GROUPS = [
  {
    group: 'Core',
    items: [
      { to: '/overview', label: 'Overview', icon: LayoutDashboard },
      { to: '/orders', label: 'Orders', icon: Package },
    ],
  },
];

const TABS = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/store', label: 'Store', icon: Store },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
];

const shell = (
  <MemoryRouter>
    <AppShell brandName="RUOStack" groups={GROUPS} tabs={TABS} comingSoon={['Live Chat']}>
      <p>content</p>
    </AppShell>
  </MemoryRouter>
);

describe('AppShell', () => {
  beforeEach(() => localStorage.clear());

  it('renders the sidebar navigation landmark', () => {
    render(shell);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('renders a bottom tab bar with a More tab', () => {
    render(shell);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('keeps coming-soon items out of the sidebar and inside the More sheet', async () => {
    // The old shells rendered these as dead rows in prime navigation space.
    render(shell);
    expect(screen.queryByText('Live Chat')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog', { name: 'All destinations' })).toBeInTheDocument();
    expect(screen.getByText('Live Chat')).toBeInTheDocument();
  });

  it('collapses the sidebar to a rail and remembers it', async () => {
    render(shell);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('ruostack_nav_collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('restores the collapsed state on mount', () => {
    localStorage.setItem('ruostack_nav_collapsed', 'true');
    render(shell);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });
});
