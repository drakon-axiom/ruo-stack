import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.js';
import { Shell } from './components/Shell.js';
import { Signup, Login, Forgot, Reset } from './screens/Auth.js';
import { Account } from './screens/Account.js';
import { Catalog } from './screens/Catalog.js';
import { Wallet } from './screens/Wallet.js';
import { Orders } from './screens/Orders.js';
import { Store } from './screens/Store.js';
import { ActionRequired } from './screens/ActionRequired.js';
import { Tracking } from './screens/Tracking.js';
import { Claims } from './screens/Claims.js';
import { Overview } from './screens/Overview.js';
import { Profit } from './screens/Profit.js';
import { Referrals } from './screens/Referrals.js';
import { Coas } from './screens/Coas.js';
import { Shipping } from './screens/Shipping.js';

function Protected({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center bg-bg text-muted">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">{title}</h1>
      <div className="surface mt-4 flex flex-col items-center gap-2 px-6 py-16 text-center">
        <div className="text-[15px] font-semibold">Coming soon</div>
        <div className="max-w-md text-[13px] text-muted">This feature is part of the platform but not available in Phase 0.</div>
      </div>
    </>
  );
}

const COMING = [
  ['customers', 'Customers'],
  ['address-book', 'Address Book'],
  ['branding', 'Branding'],
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
      <Route path="/app/account" element={<Protected><Account /></Protected>} />
      <Route path="/app/catalog" element={<Protected><Catalog /></Protected>} />
      <Route path="/app/coas" element={<Protected><Coas /></Protected>} />
      <Route path="/app/profit" element={<Protected><Profit /></Protected>} />
      <Route path="/app/shipping" element={<Protected><Shipping /></Protected>} />
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
