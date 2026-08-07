import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  DataTable,
  Drawer,
  EmptyState,
  Input,
  KpiTile,
  LinkButton,
  PageHeader,
  Package,
  Search,
  Select,
  Toolbar,
  type Column,
} from '@ruostack/ui';
import { api } from '../lib/api.js';
import { FulfillmentBadge } from '../lib/fulfillment.js';
import type { ShipTo } from './Orders.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface OrderRow {
  id: string;
  status: string;
  blocker: string;
  wallet_charge_cents: number;
  tracking_number: string | null;
  exported_at: string | null;
  created_at: string;
}

interface Customer {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string;
  state: string;
  country: string;
  orders: number;
  spend_cents: number;
  first_order: string;
  last_order: string;
  last_status: string;
  last_blocker: string;
  last_exported_at: string | null;
  /** Null when we hold no complete address for them — see `shipToFrom` on the API. */
  ship_to: ShipTo | null;
  order_list: OrderRow[];
}

interface Totals {
  customers: number;
  orders: number;
  spend_cents: number;
}

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

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
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [open, setOpen] = useState<Customer | null>(null);
  const navigate = useNavigate();

  // Hand the recipient to the manual-order drawer. Nothing is written here — the
  // Orders screen prefills a NEW order from it, the same copy-the-fields shape as
  // the address-book picker, so this never touches the address book.
  const shipAgain = (c: Customer) => navigate('/app/orders', { state: { shipTo: c.ship_to } });

  useEffect(() => {
    api<{ customers: Customer[]; totals: Totals }>('/api/brand/customers').then((r) => {
      setCustomers(r.customers);
      setTotals(r.totals);
    });
  }, []);

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
          noMatches ? (
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

      <Drawer
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpen(null);
        }}
        title={open?.name ?? 'Customer'}
        footer={
          open?.ship_to ? (
            <Button className="w-full" icon={Package} onClick={() => shipAgain(open)}>
              Ship again
            </Button>
          ) : (
            <p className="text-center text-xs text-content-faint">
              No complete address on file — can't reship
            </p>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">Email</dt>
                <dd>{open.email ?? '—'}</dd>
              </div>
              {open.phone && (
                <div className="flex justify-between gap-3">
                  <dt className="text-content-faint">Phone</dt>
                  <dd>{open.phone}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">Location</dt>
                <dd>
                  {open.city}, {open.state}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">First order</dt>
                <dd>{fmtDate(open.first_order)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">Total orders</dt>
                <dd className="tabular-nums">{open.orders}</dd>
              </div>
            </dl>

            {open.ship_to && (
              // Spelled out so "again" is never ambiguous: this is the address
              // from their most recent order that had one.
              <p className="text-xs text-content-faint">
                Ships to {open.ship_to.address1}
                {open.ship_to.address2 ? `, ${open.ship_to.address2}` : ''}, {open.ship_to.city}{' '}
                {open.ship_to.state} {open.ship_to.zip}
              </p>
            )}

            <div>
              <h3 className="mb-2 text-2xs uppercase tracking-[0.1em] text-content-faint">
                Order history
              </h3>
              <div className="space-y-2">
                {open.order_list.map((o) => (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-subtle px-3 py-2 text-xs"
                  >
                    <span className="text-content-muted">{fmtDate(o.created_at)}</span>
                    <span className="font-mono tabular-nums">{dollars(o.wallet_charge_cents)}</span>
                    <span className="font-mono text-content-muted">{o.tracking_number ?? '—'}</span>
                    <FulfillmentBadge
                      order={{ status: o.status, blocker: o.blocker, exported_at: o.exported_at }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
