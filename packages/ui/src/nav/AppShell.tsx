import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import * as RD from '@radix-ui/react-dialog';
import { cn } from '../lib/cn.js';
import { Sidebar, type NavGroup, type NavItem } from './Sidebar.js';
import { BottomTabs } from './BottomTabs.js';
import { CommandPalette } from './CommandPalette.js';
import { Toaster } from '../feedback/Toaster.js';
import { TooltipProvider } from '../overlays/Tooltip.js';
import { PanelLeftClose, PanelLeftOpen, Search } from '../icons.js';
import { Logo } from '../brand/Logo.js';

const COLLAPSE_KEY = 'ruostack_nav_collapsed';

export interface AppShellProps {
  brandName: string;
  /** Desktop sidebar and command-palette IA. */
  groups: NavGroup[];
  /** Exactly four; AppShell appends a More tab. */
  tabs: NavItem[];
  /** Labels only — rendered non-interactively in the More sheet so deferred
   *  destinations stop occupying primary navigation space. */
  comingSoon?: string[];
  headerRight?: ReactNode;
  badge?: ReactNode;
  sidebarFooter?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  brandName,
  groups,
  tabs,
  comingSoon = [],
  headerRight,
  badge,
  sidebarFooter,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
  const [moreOpen, setMoreOpen] = useState(false);

  function toggleCollapse() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, String(!c));
      return !c;
    });
  }

  // Collapsed to a rail there is only room for the mark; expanded shows the
  // full lockup. brandName remains the accessible name in both cases.
  const brand = collapsed ? (
    <Logo variant="mark" className="h-8 w-8 text-accent" />
  ) : (
    <Logo variant="full" className="text-accent" />
  );

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-canvas text-content">
        <Sidebar groups={groups} collapsed={collapsed} brand={brand} badge={badge} footer={sidebarFooter} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur md:px-8">
            <button
              onClick={toggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden rounded-md p-1.5 text-content-faint transition-colors duration-fast hover:text-content md:block"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden className="h-4 w-4" />
              ) : (
                <PanelLeftClose aria-hidden className="h-4 w-4" />
              )}
            </button>

            <Logo variant="mark" className="h-7 w-7 text-accent md:hidden" />
            <span className="text-base font-bold md:hidden">{brandName}</span>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-pill border border-line px-2.5 py-1 text-2xs text-content-faint md:inline-flex">
                <Search aria-hidden className="h-3 w-3" /> ⌘K
              </span>
              {headerRight}
            </div>
          </header>

          {/* pb-24 clears the fixed bottom tab bar on phones. */}
          <main className="min-w-0 flex-1 bg-[radial-gradient(120%_60%_at_50%_0%,var(--accent-tint),transparent_55%)] px-4 pb-24 pt-6 md:px-8 md:pb-10">
            <div className="mx-auto w-full max-w-[1100px]">{children}</div>
          </main>
        </div>

        <BottomTabs tabs={tabs} onMore={() => setMoreOpen(true)} />

        <RD.Root open={moreOpen} onOpenChange={setMoreOpen}>
          <RD.Portal>
            <RD.Overlay className="fixed inset-0 z-40 bg-black/60 md:hidden" />
            <RD.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-line bg-surface-2 px-4 pb-[env(safe-area-inset-bottom)] pt-5 shadow-e3 md:hidden">
              <RD.Title className="mb-3 text-lg font-semibold">All destinations</RD.Title>

              {groups.map((g) => (
                <div key={g.group} className="mb-4">
                  <div className="mb-1 text-2xs uppercase tracking-[0.12em] text-content-faint">
                    {g.group}
                  </div>
                  {g.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm',
                          isActive ? 'bg-accent-tint text-accent' : 'text-content-muted',
                        )
                      }
                    >
                      <Icon aria-hidden className="h-4 w-4" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              ))}

              {comingSoon.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1 text-2xs uppercase tracking-[0.12em] text-content-faint">
                    Coming soon
                  </div>
                  {comingSoon.map((label) => (
                    <div key={label} className="flex min-h-11 items-center px-3 text-sm text-content-faint/60">
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </RD.Content>
          </RD.Portal>
        </RD.Root>

        <CommandPalette groups={groups} />
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
