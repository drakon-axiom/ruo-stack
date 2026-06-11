'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SignOutButton } from './SignOutButton';

type IconName =
  | 'dashboard'
  | 'catalog'
  | 'order'
  | 'store'
  | 'branding'
  | 'wallet'
  | 'admin'
  | 'sellers'
  | 'orders'
  | 'fulfillment';

type NavItem = { label: string; href: string; icon: IconName };
type NavSection = { title: string; items: NavItem[] };

const SELLER_NAV: NavSection = {
  title: 'Selling',
  items: [
    { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
    { label: 'Catalog', href: '/catalog', icon: 'catalog' },
    { label: 'New order', href: '/dashboard/orders/new', icon: 'order' },
    { label: 'Stores', href: '/dashboard/stores', icon: 'store' },
    { label: 'Branding', href: '/dashboard/branding', icon: 'branding' },
    { label: 'Add funds', href: '/checkout', icon: 'wallet' },
  ],
};

const ADMIN_NAV: NavSection = {
  title: 'Admin',
  items: [
    { label: 'Overview', href: '/admin', icon: 'admin' },
    { label: 'Sellers', href: '/admin/sellers', icon: 'sellers' },
    { label: 'Orders', href: '/admin/orders', icon: 'orders' },
    { label: 'Fulfillment', href: '/admin/fulfillment', icon: 'fulfillment' },
  ],
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

export type AppShellClientProps = {
  email: string;
  brandName: string | null;
  logoUrl: string | null;
  role: string;
  balance: number;
  subscriptionActive: boolean;
  children: React.ReactNode;
};

export function AppShellClient({
  email,
  brandName,
  logoUrl,
  role,
  balance,
  subscriptionActive,
  children,
}: AppShellClientProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Admins and sellers use entirely separate portals — never both nav sets.
  const isAdmin = role === 'admin';
  const sections: NavSection[] = isAdmin ? [ADMIN_NAV] : [SELLER_NAV];

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-9 w-9 rounded-lg border object-contain" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            {(brandName ?? 'R').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {brandName ?? 'ruo-stack'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {isAdmin ? 'Admin console' : 'Seller'}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="dash-scroll flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {section.title}
            </p>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setDrawerOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`nav-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                        active
                          ? 'is-active bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                      }`}
                    >
                      <Icon name={item.icon} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-sidebar-border p-4">
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </p>
        <SignOutButton className="mt-3 w-full justify-center" />
      </div>
    </div>
  );

  return (
    <div className="page-bg-dash flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border md:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-sidebar-border shadow-brand-xl">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-foreground transition-colors hover:bg-accent md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="flex-1" />

          {!isAdmin && (
            <>
              <Link
                href="/checkout"
                className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent sm:inline-flex"
                title="Wallet balance — add funds"
              >
                <Icon name="wallet" />${balance.toFixed(2)}
              </Link>
              <span
                className={`hidden rounded-full px-3 py-1 text-xs sm:inline-block ${
                  subscriptionActive
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                }`}
              >
                {subscriptionActive ? 'Pro active' : 'Subscription inactive'}
              </span>
            </>
          )}
          <ThemeToggle />
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'shrink-0',
  };
  switch (name) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" />
          <rect x="14" y="3" width="7" height="5" />
          <rect x="14" y="12" width="7" height="9" />
          <rect x="3" y="16" width="7" height="5" />
        </svg>
      );
    case 'catalog':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      );
    case 'order':
      return (
        <svg {...common}>
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      );
    case 'store':
      return (
        <svg {...common}>
          <path d="M3 9l1-5h16l1 5" />
          <path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
          <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
        </svg>
      );
    case 'branding':
      return (
        <svg {...common}>
          <circle cx="13.5" cy="6.5" r=".5" />
          <circle cx="17.5" cy="10.5" r=".5" />
          <circle cx="8.5" cy="7.5" r=".5" />
          <circle cx="6.5" cy="12.5" r=".5" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
        </svg>
      );
    case 'wallet':
      return (
        <svg {...common}>
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
        </svg>
      );
    case 'admin':
      return (
        <svg {...common}>
          <path d="M22 12A10 10 0 1 1 12 2" />
          <path d="M12 12 22 2" />
          <path d="M16 2h6v6" />
        </svg>
      );
    case 'sellers':
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'orders':
      return (
        <svg {...common}>
          <path d="M9 2h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2V3a1 1 0 0 1 1-1z" />
          <path d="M9 4h6" />
          <path d="M9 11h6M9 15h4" />
        </svg>
      );
    case 'fulfillment':
      return (
        <svg {...common}>
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      );
  }
}
