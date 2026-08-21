import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppShell,
  Badge,
  Button,
  useTheme,
  LayoutDashboard,
  BarChart3,
  ListChecks,
  Store,
  FlaskConical,
  Ship,
  GitCompareArrows,
  UsersRound,
  ScrollText,
  AlertTriangle,
  ShieldAlert,
  Megaphone,
  Scale,
  Tag,
  Sun,
  Moon,
  LogOut,
  type NavGroup,
  type NavItem,
} from '@ruostack/ui';
import { useAuth } from '../lib/auth.js';
import { logout } from '../lib/api.js';

// The 13 flat links are now grouped. Same destinations, same routes.
const GROUPS: NavGroup[] = [
  {
    group: 'Operations',
    items: [
      { to: '/overview', label: 'Overview', icon: LayoutDashboard },
      { to: '/reporting', label: 'Reporting', icon: BarChart3 },
      { to: '/fulfillment', label: 'Fulfillment Queue', icon: ListChecks },
      { to: '/exceptions', label: 'Exceptions & Reconciliation', icon: AlertTriangle },
      { to: '/claims', label: 'Claims Queue', icon: ShieldAlert },
    ],
  },
  {
    group: 'Catalog & Stores',
    items: [
      { to: '/brands', label: 'Brand Manager', icon: Store },
      { to: '/catalog', label: 'Catalog Manager', icon: FlaskConical },
      { to: '/shipping-rules', label: 'Shipping Rules', icon: Ship },
      { to: '/store-match', label: 'Store Match', icon: GitCompareArrows },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/admins', label: 'Admin Users & Roles', icon: UsersRound },
      { to: '/audit', label: 'Audit Log', icon: ScrollText },
      { to: '/announcements', label: 'Announcements', icon: Megaphone },
      { to: '/ledger', label: 'Ledger & Reconciliation', icon: Scale },
      { to: '/plans', label: 'Plans', icon: Tag },
    ],
  },
];

const TABS: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/fulfillment', label: 'Queue', icon: ListChecks },
  { to: '/brands', label: 'Brands', icon: Store },
  { to: '/claims', label: 'Claims', icon: ShieldAlert },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  operations: 'Operations',
  support: 'Support',
  finance: 'Finance',
};

export function Shell({ children }: { children: ReactNode }) {
  const { claims, signOut } = useAuth();
  const { resolved, setTheme } = useTheme();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    signOut();
    navigate('/login');
  }

  return (
    <AppShell
      brandName="RUOStack"
      groups={GROUPS}
      tabs={TABS}
      badge={<Badge tone="accent">{ROLE_LABEL[claims?.role ?? ''] ?? 'Admin'}</Badge>}
      headerRight={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={resolved === 'dark' ? Sun : Moon}
            aria-label="Toggle theme"
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          />
          <Button variant="ghost" size="sm" icon={LogOut} onClick={handleSignOut}>
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
