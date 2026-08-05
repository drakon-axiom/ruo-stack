import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fulfillmentState, FULFILLMENT_META } from '@ruostack/shared';
import { api } from '../lib/api.js';
import type { ShipTo } from './Orders.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

const TONE: Record<string, string> = {
  amber: 'border-amber/40 bg-amber/10 text-amber',
  slate: 'border-lline bg-card2 text-muted dark:border-line2',
  teal: 'border-teal/40 bg-teal/10 text-teal',
  success: 'border-success/40 bg-success/10 text-success',
  muted: 'border-line2 bg-card2 text-muted',
};

function FulfillmentBadge({ order }: { order: { status: string; blocker: string; exported_at: string | null } }) {
  const meta = FULFILLMENT_META[fulfillmentState(order)];
  return <span className={`pill ${TONE[meta.tone]}`} title={meta.label}>{meta.icon} {meta.label}</span>;
}

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

const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

type SortKey = 'recent' | 'orders' | 'spend' | 'name';

// Customers — a read-only CRM view derived from the brand's own orders (no
// Customer table). Recipients are grouped by email (name+zip fallback); "spend"
// is fulfillment cost, not customer revenue (retail paid isn't stored per order).
export function Customers() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [open, setOpen] = useState<string | null>(null);
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

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">Customers</h1>
      <p className="mb-5 text-[13px] text-muted">
        Your customer list, built automatically from your orders. Spend shown is fulfillment cost — what you paid to
        ship each order.
      </p>

      {!customers ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : customers.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 px-6 py-16 text-center">
          <div className="text-[15px] font-semibold">No customers yet</div>
          <div className="max-w-md text-[13px] text-muted">
            Once you fulfill an order, its recipient shows up here. <Link className="text-teal" to="/app/orders">Create an order</Link> to get started.
          </div>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="surface px-4 py-3">
              <div className="label">Customers</div>
              <div className="text-[22px] font-bold">{totals?.customers ?? 0}</div>
            </div>
            <div className="surface px-4 py-3">
              <div className="label">Orders</div>
              <div className="text-[22px] font-bold">{totals?.orders ?? 0}</div>
            </div>
            <div className="surface px-4 py-3">
              <div className="label">Fulfillment spend</div>
              <div className="text-[22px] font-bold text-teal">{dollars(totals?.spend_cents ?? 0)}</div>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <input
              className="app-input max-w-[280px]"
              placeholder="Search name, email, or location…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-faint">Sort</span>
              <select className="app-input py-1.5 text-[12px]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="recent">Most recent</option>
                <option value="orders">Most orders</option>
                <option value="spend">Highest spend</option>
                <option value="name">Name (A–Z)</option>
              </select>
            </div>
          </div>

          <div className="surface overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3 text-right">Orders</th>
                  <th className="px-4 py-3 text-right">Spend</th>
                  <th className="px-4 py-3">Last order</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">No customers match “{q}”.</td>
                  </tr>
                ) : (
                  rows.map((c) => {
                    const isOpen = open === c.key;
                    const st = c.ship_to;
                    return (
                      <Fragment key={c.key}>
                        <tr
                          className="cursor-pointer border-b border-lline/60 hover:bg-slate-50 dark:border-line/60 dark:hover:bg-card"
                          onClick={() => setOpen(isOpen ? null : c.key)}
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{c.name}</div>
                            <div className="text-[11.5px] text-faint">{c.email ?? 'No email on file'}</div>
                          </td>
                          <td className="px-4 py-3 text-muted">{c.city}, {c.state}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{c.orders}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{dollars(c.spend_cents)}</td>
                          <td className="px-4 py-3 text-muted">{fmtDate(c.last_order)}</td>
                          <td className="px-4 py-3">
                            <FulfillmentBadge order={{ status: c.last_status, blocker: c.last_blocker, exported_at: c.last_exported_at }} />
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-lline/60 bg-slate-50/60 dark:border-line/60 dark:bg-card/40">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                                <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted">
                                  {c.phone && <span>📞 {c.phone}</span>}
                                  <span>First order {fmtDate(c.first_order)}</span>
                                  <span>{c.orders} order{c.orders === 1 ? '' : 's'} total</span>
                                </div>
                                {st ? (
                                  <button className="btn text-[12px]" onClick={() => shipAgain(c)}>📦 Ship again</button>
                                ) : (
                                  <span className="text-[11.5px] text-faint">No complete address on file — can’t reship</span>
                                )}
                              </div>
                              {st && (
                                // Spelled out so "again" is never ambiguous: this is the
                                // address from their most recent order that had one.
                                <div className="mb-3 text-[11.5px] text-faint">
                                  Ships to {st.address1}{st.address2 ? `, ${st.address2}` : ''}, {st.city} {st.state} {st.zip}
                                </div>
                              )}
                              <table className="w-full text-[12.5px]">
                                <thead>
                                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-faint">
                                    <th className="py-1.5 pr-4">Date</th>
                                    <th className="py-1.5 pr-4">Charge</th>
                                    <th className="py-1.5 pr-4">Tracking</th>
                                    <th className="py-1.5">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.order_list.map((o) => (
                                    <tr key={o.id} className="border-t border-lline/40 dark:border-line/40">
                                      <td className="py-1.5 pr-4 text-muted">{fmtDate(o.created_at)}</td>
                                      <td className="py-1.5 pr-4 tabular-nums">{dollars(o.wallet_charge_cents)}</td>
                                      <td className="py-1.5 pr-4 text-muted">{o.tracking_number ?? '—'}</td>
                                      <td className="py-1.5">
                                        <FulfillmentBadge order={{ status: o.status, blocker: o.blocker, exported_at: o.exported_at }} />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
