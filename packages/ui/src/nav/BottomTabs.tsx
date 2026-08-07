import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn.js';
import { MoreHorizontal } from '../icons.js';
import type { NavItem } from './Sidebar.js';

/** Phone-only primary navigation. Four destinations plus More, so the daily
 *  path is one tap rather than open-drawer-then-pick. */
export function BottomTabs({ tabs, onMore }: { tabs: NavItem[]; onMore: () => void }) {
  return (
    <nav
      aria-label="Primary"
      // env(safe-area-inset-bottom) clears the iOS home indicator.
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-2xs',
              isActive ? 'text-accent' : 'text-content-faint',
            )
          }
        >
          <Icon aria-hidden className="h-5 w-5" />
          {label}
        </NavLink>
      ))}

      <button
        onClick={onMore}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-2xs text-content-faint"
      >
        <MoreHorizontal aria-hidden className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}
