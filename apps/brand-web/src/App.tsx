import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.js';
import { Shell } from './components/Shell.js';
import { Signup, Login, Forgot, Reset } from './screens/Auth.js';
import { Card } from '@ruostack/ui';

// The auth screens above stay in the entry chunk: they are what a logged-out
// visitor renders first, so splitting them would just add a round-trip in front
// of the login form.
//
// Every /app screen below is a separate chunk. Statically importing all 22 put
// them in one 716 kB bundle that every visitor downloaded in full before React
// could boot -- including the 21 screens they were not navigating to.
//
// Written out rather than generated: React.lazy needs a default export and
// these are named, and a static `import('./screens/X.js')` literal is what lets
// Rollup see the chunk boundary at build time.
const Account = lazy(() => import('./screens/Account.js').then((m) => ({ default: m.Account })));
const ActionRequired = lazy(() => import('./screens/ActionRequired.js').then((m) => ({ default: m.ActionRequired })));
const AddressBook = lazy(() => import('./screens/AddressBook.js').then((m) => ({ default: m.AddressBook })));
const Branding = lazy(() => import('./screens/Branding.js').then((m) => ({ default: m.Branding })));
const Catalog = lazy(() => import('./screens/Catalog.js').then((m) => ({ default: m.Catalog })));
const Claims = lazy(() => import('./screens/Claims.js').then((m) => ({ default: m.Claims })));
const Coas = lazy(() => import('./screens/Coas.js').then((m) => ({ default: m.Coas })));
const Customers = lazy(() => import('./screens/Customers.js').then((m) => ({ default: m.Customers })));
const Notifications = lazy(() => import('./screens/Notifications.js').then((m) => ({ default: m.Notifications })));
const Orders = lazy(() => import('./screens/Orders.js').then((m) => ({ default: m.Orders })));
const Overview = lazy(() => import('./screens/Overview.js').then((m) => ({ default: m.Overview })));
const Profit = lazy(() => import('./screens/Profit.js').then((m) => ({ default: m.Profit })));
const Referrals = lazy(() => import('./screens/Referrals.js').then((m) => ({ default: m.Referrals })));
const Shipping = lazy(() => import('./screens/Shipping.js').then((m) => ({ default: m.Shipping })));
const Store = lazy(() => import('./screens/Store.js').then((m) => ({ default: m.Store })));
const Team = lazy(() => import('./screens/Team.js').then((m) => ({ default: m.Team })));
const Tracking = lazy(() => import('./screens/Tracking.js').then((m) => ({ default: m.Tracking })));
const Wallet = lazy(() => import('./screens/Wallet.js').then((m) => ({ default: m.Wallet })));

/**
 * Shown while a route's chunk downloads. This sits INSIDE Shell, so the sidebar,
 * header, and tabs are already painted around it -- navigation never blanks out.
 */
function ScreenFallback() {
  return <div className="grid place-items-center py-24 text-sm text-content-muted">Loading…</div>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center bg-canvas text-content-muted">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <Shell>
      <Suspense fallback={<ScreenFallback />}>{children}</Suspense>
    </Shell>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">{title}</h1>
      <Card className="mt-4 flex flex-col items-center gap-2 px-6 py-16 text-center">
        <div className="text-lg font-semibold">Coming soon</div>
        <div className="max-w-md text-sm text-content-muted">This feature is part of the platform but not available in Phase 0.</div>
      </Card>
    </>
  );
}

const COMING = [
  ['chat', 'Live Chat'],
] as const;

export function App() {
  return (
    <Routes>
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />

      <Route path="/app/overview" element={<Protected><Overview /></Protected>} />
      <Route path="/app/notifications" element={<Protected><Notifications /></Protected>} />
      <Route path="/app/account" element={<Protected><Account /></Protected>} />
      <Route path="/app/team" element={<Protected><Team /></Protected>} />
      <Route path="/app/catalog" element={<Protected><Catalog /></Protected>} />
      <Route path="/app/coas" element={<Protected><Coas /></Protected>} />
      <Route path="/app/profit" element={<Protected><Profit /></Protected>} />
      <Route path="/app/shipping" element={<Protected><Shipping /></Protected>} />
      <Route path="/app/branding" element={<Protected><Branding /></Protected>} />
      <Route path="/app/customers" element={<Protected><Customers /></Protected>} />
      <Route path="/app/address-book" element={<Protected><AddressBook /></Protected>} />
      <Route path="/app/referrals" element={<Protected><Referrals /></Protected>} />
      <Route path="/app/wallet" element={<Protected><Wallet /></Protected>} />
      <Route path="/app/orders" element={<Protected><Orders /></Protected>} />
      <Route path="/app/store" element={<Protected><Store /></Protected>} />
      <Route path="/app/action-required" element={<Protected><ActionRequired /></Protected>} />
      <Route path="/app/tracking" element={<Protected><Tracking /></Protected>} />
      <Route path="/app/claims" element={<Protected><Claims /></Protected>} />
      {COMING.map(([slug, title]) => (
        <Route key={slug} path={`/app/${slug}`} element={<Protected><ComingSoon title={title} /></Protected>} />
      ))}

      <Route path="*" element={<Navigate to="/app/overview" replace />} />
    </Routes>
  );
}
