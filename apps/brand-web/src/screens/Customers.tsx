import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  DataTable,
  EmptyState,
  Input,
  KpiTile,
  LinkButton,
  PageHeader,
  Search,
  Select,
  Toolbar,
  type Column,
} from '@ruostack/ui';
import { api } from '../lib/api.js';
import { FulfillmentBadge } from '../lib/fulfillment.js';
import { CustomerDrawer } from './customers/CustomerDrawer.js';
import { dollars, fmtDate, type Customer, type Totals } from './customers/types.js';

type SortKey = 'recent' | 'orders' | 'spend' | 'name';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'orders', label: 'Most orders' },
  { value: 'spend', label: 'Highest spend' },
  { value: 'name', label: 'Name (A–Z)' },
];

// Customers — a read-only CRM view derived from the brand's own orders (no
// Customer table). Recipients are grouped by email (name+zip fallback); "spend"
// is fulfillment cost, not customer revenue (retail paid isn't stored per order).
export function Customers() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [open, setOpen] = useState<Customer | null>(null);
  const navigate = useNavigate();

  // Hand the recipient to the manual-order drawer. Nothing is written here — the
  // Orders screen prefills a NEW order from it, the same copy-the-fields shape as
  // the address-book picker, so this never touches the address book.
  const shipAgain = (c: Customer) => navigate('/app/orders', { state: { shipTo: c.ship_to } });

  useEffect(() => {
    let active = true;
    setError(null); setCustomers(null);
    api<{ customers: Customer[]; totals: Totals }>('/api/brand/customers?view=summary').then((r) => {
      if (active) { setCustomers(r.customers); setTotals(r.totals); }
    }).catch(() => { if (active) { setError('Could not load customers.'); setCustomers([]); } });
    return () => { active = false; };
  }, [attempt]);

  const rows = useMemo(() => {
    let list = customers ?? [];
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.email ?? '').toLowerCase().includes(term) ||
          `${c.city} ${c.state}`.toLowerCase().includes(term),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'orders':
          return b.orders - a.orders;
        case 'spend':
          return b.spend_cents - a.spend_cents;
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return new Date(b.last_order).getTime() - new Date(a.last_order).getTime();
      }
    });
    return sorted;
  }, [customers, q, sort]);

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer', priority: 'primary', cell: (c) => c.name },
    {
      key: 'email',
      header: 'Email',
      priority: 'meta',
      cell: (c) => c.email ?? 'No email on file',
    },
    { key: 'location', header: 'Location', cell: (c) => `${c.city}, ${c.state}` },
    { key: 'orders', header: 'Orders', align: 'right', mono: true, cell: (c) => c.orders },
    {
      key: 'spend',
      header: 'Spend',
      align: 'right',
      mono: true,
      cell: (c) => dollars(c.spend_cents),
    },
    { key: 'last', header: 'Last order', cell: (c) => fmtDate(c.last_order) },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => (
        <FulfillmentBadge
          order={{ status: c.last_status, blocker: c.last_blocker, exported_at: c.last_exported_at }}
        />
      ),
    },
  ];

  const noMatches = customers !== null && customers.length > 0 && rows.length === 0;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Your customer list, built automatically from your orders. Spend shown is fulfillment cost — what you paid to ship each order."
      />

      {totals?.truncated && <p role="note" className="mb-4 text-sm text-content-muted">Totals cover the most recent 5,000 orders for your brand.</p>}
      {customers !== null && customers.length > 0 && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiTile label="Customers" value={totals?.customers ?? 0} />
            <KpiTile label="Orders" value={totals?.orders ?? 0} />
            <KpiTile label="Fulfillment spend" value={dollars(totals?.spend_cents ?? 0)} tone="accent" />
          </div>

          <Toolbar>
            <div className="relative w-full max-w-[280px]">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint"
              />
              <Input
                className="pl-9"
                placeholder="Search name, email, or location…"
                aria-label="Search customers"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-content-faint">Sort</span>
              <Select
                className="w-40"
                value={sort}
                onValueChange={(v) => setSort(v as SortKey)}
                options={SORTS}
              />
            </div>
          </Toolbar>
        </>
      )}

      <DataTable
        caption="Customers derived from your orders"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.key}
        loading={customers === null}
        onRowClick={setOpen}
        empty={
          error ? <EmptyState title={error} action={<Button onClick={() => setAttempt(a => a + 1)}>Retry customers</Button>} /> : noMatches ? (
            <EmptyState title={`No customers match “${q}”`} hint="Try a different search term." />
          ) : (
            <EmptyState
              title="No customers yet"
              hint="Once you fulfill an order, its recipient shows up here."
              action={<LinkButton to="/app/orders">Create an order</LinkButton>}
            />
          )
        }
      />

      {open && <CustomerDrawer key={open.key} customer={open} onClose={() => setOpen(null)} onShipAgain={shipAgain} />}
    </>
  );
}
