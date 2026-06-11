import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.js';
import { Shell } from './components/Shell.js';
import { Login } from './screens/Login.js';
import { Catalog } from './screens/Catalog.js';
import { AdminUsers } from './screens/AdminUsers.js';
import { AuditLog } from './screens/AuditLog.js';
import { EmptyState, PageHeader } from './components/ui.js';

function Protected({ children }: { children: React.ReactNode }) {
  const { claims } = useAuth();
  if (!claims) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
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
      <Route path="/admins" element={<Protected><AdminUsers /></Protected>} />
      <Route path="/audit" element={<Protected><AuditLog /></Protected>} />
      <Route path="/overview" element={<Protected><ComingSoon title="Overview" /></Protected>} />
      <Route path="/fulfillment" element={<Protected><ComingSoon title="Fulfillment Queue" /></Protected>} />
      <Route path="/exceptions" element={<Protected><ComingSoon title="Exceptions Console" /></Protected>} />
      <Route path="/claims" element={<Protected><ComingSoon title="Claims Queue" /></Protected>} />
      <Route path="/brands" element={<Protected><ComingSoon title="Brand Manager" /></Protected>} />
      <Route path="/ledger" element={<Protected><ComingSoon title="Ledger & Reconciliation" /></Protected>} />
      <Route path="*" element={<Navigate to="/catalog" replace />} />
    </Routes>
  );
}
