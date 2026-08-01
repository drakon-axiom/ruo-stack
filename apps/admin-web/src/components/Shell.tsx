import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth.js';
import { logout } from '../lib/api.js';

// Phase 0 active destinations + later-phase items (disabled) so the IA is
// visible without implying it's built.
const NAV: { to: string; label: string; phase0: boolean }[] = [
  { to: '/overview', label: 'Overview', phase0: true },
  { to: '/reporting', label: 'Reporting', phase0: true },
  { to: '/fulfillment', label: 'Fulfillment Queue', phase0: true },
  { to: '/brands', label: 'Brand Manager', phase0: true },
  { to: '/catalog', label: 'Catalog Manager', phase0: true },
  { to: '/shipping-rules', label: 'Shipping Rules', phase0: true },
  { to: '/store-match', label: 'Store Match', phase0: true },
  { to: '/admins', label: 'Admin Users & Roles', phase0: true },
  { to: '/audit', label: 'Audit Log', phase0: true },
  { to: '/exceptions', label: 'Exceptions & Reconciliation', phase0: true },
  { to: '/claims', label: 'Claims Queue', phase0: true },
  { to: '/announcements', label: 'Announcements', phase0: true },
  { to: '/ledger', label: 'Ledger & Reconciliation', phase0: true },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  operations: 'Operations',
  support: 'Support',
  finance: 'Finance',
};

export function Shell({ children }: { children: ReactNode }) {
  const { claims, signOut } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    signOut();
    navigate('/login');
  }

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr]">
      <nav className="sticky top-0 flex h-screen flex-col border-r border-line bg-navy px-4 py-6">
        {/* Reversed logo on navy — distinct admin chrome. */}
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal text-[15px] font-black text-white">
            R
          </span>
          <span className="text-[18px] font-bold text-white">RUOStack</span>
        </div>
        <div className="mb-6 inline-flex w-fit items-center gap-1.5 rounded-pill border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-teal-bright">
          ● {ROLE_LABEL[claims?.role ?? ''] ?? 'Admin'}
        </div>

        <div className="flex-1 space-y-0.5">
          {NAV.map((item) =>
            item.phase0 ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-[13.5px] ${
                    isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <div
                key={item.to}
                title="Coming in a later phase"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-[13.5px] text-white/30"
              >
                {item.label}
                <span className="text-[9px] uppercase tracking-wide">soon</span>
              </div>
            ),
          )}
        </div>

        <button onClick={handleSignOut} className="btn-ghost border-white/15 text-white/70 hover:text-white">
          Sign out
        </button>
      </nav>

      <main className="overflow-y-auto px-10 py-8">
        <div className="mx-auto max-w-[1100px]">{children}</div>
      </main>
    </div>
  );
}
