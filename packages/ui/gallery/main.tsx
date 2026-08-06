/* Component harness for the responsive regression gate.
 *
 * The apps gate every meaningful screen behind auth, so Playwright driving the
 * real app can only reach the login page — which exercises none of the shell or
 * table behaviour that the mobile work is about. This mounts AppShell and
 * DataTable directly with fixture data, so the overflow test covers the actual
 * components that decide mobile layout.
 *
 * Doubles as a gallery for design work: `pnpm --filter @ruostack/ui gallery`.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import {
  AppShell,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  KpiTile,
  PageHeader,
  StatusPill,
  ThemeProvider,
  LayoutDashboard,
  Package,
  FlaskConical,
  Wallet,
  Truck,
  ShieldAlert,
  Plus,
  type Column,
  type NavGroup,
  type NavItem,
} from '../src/index.js';
import './gallery.css';

interface Row {
  id: string;
  name: string;
  city: string;
  charge: string;
  status: string;
  tracking: string;
}

const ROWS: Row[] = Array.from({ length: 12 }, (_, i) => ({
  id: String(i),
  name: ['M. Reyes', 'J. Chen', 'A. Novak', 'R. Patel'][i % 4]!,
  city: ['Austin, TX', 'Portland, OR', 'Tampa, FL', 'Boise, ID'][i % 4]!,
  charge: `$${(80 + i * 17).toFixed(2)}`,
  status: ['shipped', 'delivered', 'ready_for_fulfillment', 'awaiting_funds'][i % 4]!,
  tracking: `9405511899560000000${i}`,
}));

const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Recipient', priority: 'primary', cell: (r) => r.name },
  { key: 'city', header: 'Destination', priority: 'meta', cell: (r) => r.city },
  { key: 'charge', header: 'Charge', align: 'right', mono: true, cell: (r) => r.charge },
  { key: 'status', header: 'Status', cell: (r) => <StatusPill value={r.status} /> },
  { key: 'tracking', header: 'Tracking', mono: true, cell: (r) => r.tracking },
];

// A deliberately wide table, to prove scroll mode contains its own overflow
// rather than pushing the page sideways.
const WIDE_COLUMNS: Column<Row>[] = [
  ...COLUMNS.map((c) => ({ ...c, minWidth: 180 })),
  { key: 'x1', header: 'Extra one', minWidth: 180, cell: (r) => r.city },
  { key: 'x2', header: 'Extra two', minWidth: 180, cell: (r) => r.tracking },
  { key: 'x3', header: 'Extra three', minWidth: 180, cell: (r) => r.charge },
];

const GROUPS: NavGroup[] = [
  {
    group: 'Core',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/orders', label: 'Orders', icon: Package },
      { to: '/tracking', label: 'Tracking', icon: Truck },
      { to: '/claims', label: 'Claims', icon: ShieldAlert },
    ],
  },
  {
    group: 'Catalog',
    items: [{ to: '/catalog', label: 'Research Peptides', icon: FlaskConical }],
  },
];

const TABS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/catalog', label: 'Catalog', icon: FlaskConical },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
];

function Gallery() {
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Component harness — every mobile-critical primitive on one page."
        action={<Button icon={Plus}>New order</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Orders today" value={18} />
        <KpiTile label="Action required" value={2} tone="warning" />
        <KpiTile label="Wallet available" value="$4,120.00" tone="accent" />
        <KpiTile label="Current plan" value="Pro" />
      </div>

      <div className="mt-4 space-y-3">
        <InlineAlert tone="warning" action={<Button size="sm">Review</Button>}>
          2 orders need attention.
        </InlineAlert>

        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">Form controls</h2>
          <Field label="Recipient name" htmlFor="g-name">
            <Input id="g-name" placeholder="Jane Doe" />
          </Field>
          <Field label="Email" htmlFor="g-email" error="Required">
            <Input id="g-email" invalid placeholder="jane@example.com" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Loading</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="accent">accent</Badge>
            <Badge tone="success">success</Badge>
            <Badge tone="warning">warning</Badge>
            <Badge tone="danger">danger</Badge>
            <Badge tone="info">info</Badge>
          </div>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-2xs uppercase tracking-[0.12em] text-content-faint">
        DataTable — card mode
      </h2>
      <DataTable
        caption="Recent orders"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        onRowClick={() => undefined}
      />

      <h2 className="mb-2 mt-6 text-2xs uppercase tracking-[0.12em] text-content-faint">
        DataTable — scroll mode (deliberately wide)
      </h2>
      <DataTable
        caption="Wide operator queue"
        mode="scroll"
        columns={WIDE_COLUMNS}
        rows={ROWS.slice(0, 5)}
        rowKey={(r) => r.id}
      />

      <h2 className="mb-2 mt-6 text-2xs uppercase tracking-[0.12em] text-content-faint">
        Empty state
      </h2>
      <EmptyState
        title="No orders yet"
        hint="Create your first order and it will show up here."
        action={<Button>New order</Button>}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider storageKey="ruostack_gallery_theme">
      <BrowserRouter>
        <AppShell brandName="RUOStack" groups={GROUPS} tabs={TABS} comingSoon={['Live Chat']}>
          <Routes>
            <Route path="*" element={<Gallery />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
