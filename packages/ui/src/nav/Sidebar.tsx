import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Tooltip } from '../overlays/Tooltip.js';
import type { LucideIcon } from '../icons.js';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** Desktop-only. Hidden below md, where BottomTabs takes over. */
export function Sidebar({
  groups,
  collapsed,
  brand,
  badge,
  footer,
}: {
  groups: NavGroup[];
  collapsed: boolean;
  brand: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-1 py-5 md:flex',
        collapsed ? 'w-16 px-2' : 'w-[260px] px-3',
      )}
    >
      <div className={cn('mb-4 flex items-center gap-2', collapsed && 'justify-center')}>{brand}</div>
      {badge && !collapsed && <div className="mb-4">{badge}</div>}

      <div className="flex-1 space-y-4">
        {groups.map((g) => (
          <div key={g.group}>
            {!collapsed && (
              <div className="mb-1 px-2 text-2xs uppercase tracking-[0.12em] text-content-faint">
                {g.group}
              </div>
            )}

            {g.items.map(({ to, label, icon: Icon }) => {
              const link = (
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-fast',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? // The inset bar means active state is never colour-only.
                          'bg-accent-tint text-accent before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-accent'
                        : 'text-content-muted hover:bg-surface-3 hover:text-content',
                    )
                  }
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              );

              // Collapsed to a rail, the label is gone — tooltip restores it.
              return collapsed ? (
                <Tooltip key={to} label={label}>
                  {link}
                </Tooltip>
              ) : (
                <div key={to}>{link}</div>
              );
            })}
          </div>
        ))}
      </div>

      {footer && <div className="pt-4">{footer}</div>}
    </nav>
  );
}
