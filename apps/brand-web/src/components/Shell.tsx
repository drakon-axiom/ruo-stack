import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { NotificationBell } from './NotificationBell.js';

// Full Pepify IA. Non-Phase-0 items are disabled / routed to "Coming soon" so
// the structure is visible without implying it's built.
const GROUPS: { group: string; items: { to: string; label: string; phase0?: boolean }[] }[] = [
  {
    group: 'Core',
    items: [
      { to: '/app/overview', label: 'Overview', phase0: true },
      { to: '/app/orders', label: 'Orders', phase0: true },
      { to: '/app/tracking', label: 'Tracking', phase0: true },
      { to: '/app/claims', label: 'Claims', phase0: true },
      { to: '/app/action-required', label: 'Action Required', phase0: true },
      { to: '/app/customers', label: 'Customers', phase0: true },
      { to: '/app/address-book', label: 'Address Book', phase0: true },
      { to: '/app/wallet', label: 'Wallet', phase0: true },
    ],
  },
  { group: 'Store', items: [{ to: '/app/store', label: 'My Store', phase0: true }] },
  {
    group: 'Catalog',
    items: [
      { to: '/app/catalog', label: 'Research Peptides', phase0: true },
      { to: '/app/coas', label: 'COAs', phase0: true },
    ],
  },
  {
    group: 'Brand & Tools',
    items: [
      { to: '/app/branding', label: 'Branding', phase0: true },
      { to: '/app/shipping', label: 'Shipping', phase0: true },
      { to: '/app/profit', label: 'Profit Calculator', phase0: true },
    ],
  },
  {
    group: 'Support',
    items: [
      { to: '/app/chat', label: 'Live Chat' },
      { to: '/app/referrals', label: 'Referrals', phase0: true },
      { to: '/app/account', label: 'Account', phase0: true },
    ],
  },
];

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('ruostack_theme') !== 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ruostack_theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function Shell({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-lbg text-ltext dark:bg-bg dark:text-text">
      <nav className="sticky top-0 flex h-screen flex-col overflow-y-auto border-r border-lline bg-white px-4 py-6 dark:border-line dark:bg-bg2">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal text-[15px] font-black text-white">R</span>
          <span className="text-[18px] font-bold">RUOStack</span>
        </div>
        <div className="flex-1 space-y-4">
          {GROUPS.map((g) => (
            <div key={g.group}>
              <div className="mb-1 px-2 text-[10px] uppercase tracking-[0.12em] text-faint">{g.group}</div>
              {g.items.map((item) =>
                item.phase0 ? (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-1.5 text-[13.5px] ${
                        isActive
                          ? 'bg-teal/10 text-teal'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-muted dark:hover:bg-card'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ) : (
                  <div
                    key={item.to}
                    title="Coming in a later phase"
                    className="flex items-center justify-between rounded-lg px-3 py-1.5 text-[13.5px] text-slate-300 dark:text-white/25"
                  >
                    {item.label}
                    <span className="text-[9px] uppercase">soon</span>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      </nav>

      <div className="flex flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-lline px-8 py-3 dark:border-line">
          <NotificationBell />
          <button onClick={toggle} className="btn-ghost text-[12px]">{dark ? '☀ Light' : '☾ Dark'}</button>
          <button onClick={handleSignOut} className="btn-ghost text-[12px]">Sign out</button>
        </header>
        <main className="overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-[1000px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
