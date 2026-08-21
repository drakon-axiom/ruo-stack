import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.js';
import { Shell } from './components/Shell.js';
import { Login } from './screens/Login.js';
import { EmptyState, PageHeader } from '@ruostack/ui';

// Login stays in the entry chunk -- it is the first thing an unauthenticated
// operator renders. Every screen below is its own chunk; see the equivalent
// comment in apps/brand-web/src/App.tsx for the reasoning.
const AdminUsers = lazy(() => import('./screens/AdminUsers.js').then((m) => ({ default: m.AdminUsers })));
const Announcements = lazy(() => import('./screens/Announcements.js').then((m) => ({ default: m.Announcements })));
const AuditLog = lazy(() => import('./screens/AuditLog.js').then((m) => ({ default: m.AuditLog })));
const Brands = lazy(() => import('./screens/Brands.js').then((m) => ({ default: m.Brands })));
const Catalog = lazy(() => import('./screens/Catalog.js').then((m) => ({ default: m.Catalog })));
const CatalogImport = lazy(() => import('./screens/CatalogImport.js').then((m) => ({ default: m.CatalogImport })));
const Claims = lazy(() => import('./screens/Claims.js').then((m) => ({ default: m.Claims })));
const Exceptions = lazy(() => import('./screens/Exceptions.js').then((m) => ({ default: m.Exceptions })));
const Fulfillment = lazy(() => import('./screens/Fulfillment.js').then((m) => ({ default: m.Fulfillment })));
const Ledger = lazy(() => import('./screens/Ledger.js').then((m) => ({ default: m.Ledger })));
const Overview = lazy(() => import('./screens/Overview.js').then((m) => ({ default: m.Overview })));
const Plans = lazy(() => import('./screens/Plans.js').then((m) => ({ default: m.Plans })));
const Reporting = lazy(() => import('./screens/Reporting.js').then((m) => ({ default: m.Reporting })));
const ShippingRules = lazy(() => import('./screens/ShippingRules.js').then((m) => ({ default: m.ShippingRules })));
const StoreMatch = lazy(() => import('./screens/StoreMatch.js').then((m) => ({ default: m.StoreMatch })));

/** Fills the content area while a route's chunk downloads; Shell stays painted. */
function ScreenFallback() {
  return <div className="grid place-items-center py-24 text-sm text-content-muted">Loading…</div>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { claims } = useAuth();
  if (!claims) return <Navigate to="/login" replace />;
  return (
    <Shell>
      <Suspense fallback={<ScreenFallback />}>{children}</Suspense>
    </Shell>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Coming in a later phase" hint="This surface is part of the architecture but not built in Phase 0." />
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/catalog" element={<Protected><Catalog /></Protected>} />
      <Route path="/catalog/import" element={<Protected><CatalogImport /></Protected>} />
      <Route path="/admins" element={<Protected><AdminUsers /></Protected>} />
      <Route path="/audit" element={<Protected><AuditLog /></Protected>} />
      <Route path="/overview" element={<Protected><Overview /></Protected>} />
      <Route path="/reporting" element={<Protected><Reporting /></Protected>} />
      <Route path="/fulfillment" element={<Protected><Fulfillment /></Protected>} />
      <Route path="/shipping-rules" element={<Protected><ShippingRules /></Protected>} />
      <Route path="/store-match" element={<Protected><StoreMatch /></Protected>} />
      <Route path="/exceptions" element={<Protected><Exceptions /></Protected>} />
      <Route path="/claims" element={<Protected><Claims /></Protected>} />
      <Route path="/brands" element={<Protected><Brands /></Protected>} />
      <Route path="/announcements" element={<Protected><Announcements /></Protected>} />
      <Route path="/ledger" element={<Protected><Ledger /></Protected>} />
      <Route path="/plans" element={<Protected><Plans /></Protected>} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
