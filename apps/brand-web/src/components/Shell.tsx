import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppShell,
  Button,
  useTheme,
  LayoutDashboard,
  Package,
  Truck,
  ShieldAlert,
  AlertTriangle,
  Users,
  BookUser,
  Wallet,
  Store,
  FlaskConical,
  FileCheck2,
  Palette,
  Ship,
  Calculator,
  Gift,
  UsersRound,
  Settings,
  Sun,
  Moon,
  LogOut,
  type NavGroup,
  type NavItem,
} from '@ruostack/ui';
import { useAuth } from '../lib/auth.js';
import { NotificationBell } from './NotificationBell.js';

const GROUPS: NavGroup[] = [
  {
    group: 'Core',
    items: [
      { to: '/app/overview', label: 'Overview', icon: LayoutDashboard },
      { to: '/app/orders', label: 'Orders', icon: Package },
      { to: '/app/tracking', label: 'Tracking', icon: Truck },
      { to: '/app/claims', label: 'Claims', icon: ShieldAlert },
      { to: '/app/action-required', label: 'Action Required', icon: AlertTriangle },
      { to: '/app/customers', label: 'Customers', icon: Users },
      { to: '/app/address-book', label: 'Address Book', icon: BookUser },
      { to: '/app/wallet', label: 'Wallet', icon: Wallet },
    ],
  },
  { group: 'Store', items: [{ to: '/app/store', label: 'My Store', icon: Store }] },
  {
    group: 'Catalog',
    items: [
      { to: '/app/catalog', label: 'Research Peptides', icon: FlaskConical },
      { to: '/app/coas', label: 'COAs', icon: FileCheck2 },
    ],
  },
  {
    group: 'Brand & Tools',
    items: [
      { to: '/app/branding', label: 'Branding', icon: Palette },
      { to: '/app/shipping', label: 'Shipping', icon: Ship },
      { to: '/app/profit', label: 'Profit Calculator', icon: Calculator },
    ],
  },
  {
    group: 'Support',
    items: [
      { to: '/app/referrals', label: 'Referrals', icon: Gift },
      { to: '/app/team', label: 'Team', icon: UsersRound },
      { to: '/app/account', label: 'Account', icon: Settings },
    ],
  },
];

// The four destinations that carry the daily job. AppShell appends "More".
const TABS: NavItem[] = [
  { to: '/app/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/app/orders', label: 'Orders', icon: Package },
  { to: '/app/catalog', label: 'Catalog', icon: FlaskConical },
  { to: '/app/wallet', label: 'Wallet', icon: Wallet },
];

export function Shell({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { resolved, setTheme } = useTheme();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <AppShell
      brandName="RUOStack"
      groups={GROUPS}
      tabs={TABS}
      comingSoon={['Live Chat']}
      headerRight={
        <>
          <NotificationBell />
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
