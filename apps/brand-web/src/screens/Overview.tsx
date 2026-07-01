import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fulfillmentState, FULFILLMENT_META } from '@ruostack/shared';
import { api } from '../lib/api.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', volume: 'Volume' };

const TONE: Record<string, string> = {
  amber: 'border-amber/40 bg-amber/10 text-amber',
  slate: 'border-lline bg-card2 text-muted dark:border-line2',
  teal: 'border-teal/40 bg-teal/10 text-teal',
  success: 'border-success/40 bg-success/10 text-success',
  muted: 'border-line2 bg-card2 text-muted',
};

interface RecentOrder {
  id: string;
  recipient: { name: string; city: string; state: string };
  wallet_charge_cents: number;
  status: string;
  blocker: string;
  exported_at: string | null;
  tracking_number: string | null;
  created_at: string;
}
interface Overview {
  orders: { today: number; ready: number; shipped: number; delivered: number; total: number; action_required: number };
  wallet: { available_cents: number; balance_cents: number; held_cents: number };
  plan: string;
  checklist: { store_connected: boolean; wallet_funded: boolean; retail_set: boolean; first_order: boolean };
  recent_orders: RecentOrder[];
}

function FulfillmentBadge({ order }: { order: { status: string; blocker: string; exported_at: string | null } }) {
  const meta = FULFILLMENT_META[fulfillmentState(order)];
  return <span className={`pill ${TONE[meta.tone]}`} title={meta.label}>{meta.icon} {meta.label}</span>;
}

const CHECKLIST: { key: keyof Overview['checklist']; label: string; to: string; cta: string }[] = [
  { key: 'store_connected', label: 'Connect your store', to: '/app/store', cta: 'Connect' },
  { key: 'wallet_funded', label: 'Fund your wallet', to: '/app/wallet', cta: 'Add funds' },
  { key: 'retail_set', label: 'Set your retail prices', to: '/app/catalog', cta: 'Set prices' },
  { key: 'first_order', label: 'Place your first order', to: '/app/orders', cta: 'New order' },
];

export function Overview() {
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => { api<Overview>('/api/brand/overview').then(setData); }, []);

  const checklistDone = data ? CHECKLIST.every((c) => data.checklist[c.key]) : true;

  return (
    <>
      <div className="mb-1 flex items-end justify-between">
        <div>
          <h1 className="text-[23px] font-bold">Overview</h1>
          <p className="mt-1 text-[13px] text-muted">Your fulfillment at a glance — orders, wallet, and what to do next.</p>
        </div>
        <Link to="/app/orders" className="btn">+ New order</Link>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-3">
        <div className="surface p-4">
          <div className="text-[26px] font-extrabold">{data ? data.orders.today : '—'}</div>
          <div className="text-[12px] text-muted">Orders today</div>
        </div>
        <div className="surface p-4">
          <div className={`text-[26px] font-extrabold ${data && data.orders.action_required > 0 ? 'text-amber' : ''}`}>
            {data ? data.orders.action_required : '—'}
          </div>
          <div className="text-[12px] text-muted">Action required</div>
        </div>
        <div className="surface p-4">
          <div className="text-[26px] font-extrabold text-teal">{data ? dollars(data.wallet.available_cents) : '—'}</div>
          <div className="text-[12px] text-muted">Wallet available</div>
        </div>
        <div className="surface p-4">
          <div className="text-[26px] font-extrabold">{data ? PLAN_LABEL[data.plan] ?? data.plan : '—'}</div>
          <div className="text-[12px] text-muted">Current plan</div>
        </div>
      </div>

      {data && data.orders.action_required > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-amber/40 bg-amber/10 px-4 py-3">
          <span className="text-[13px] text-amber">
            {data.orders.action_required} order{data.orders.action_required > 1 ? 's' : ''} need attention.
          </span>
          <Link to="/app/action-required" className="btn">Review</Link>
        </div>
      )}

      {data && !checklistDone && (
        <div className="surface mt-5 p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Get started</h2>
          <p className="mb-3 text-[12px] text-muted">A few steps to start fulfilling under your label.</p>
          <div className="space-y-2">
            {CHECKLIST.map((c) => {
              const done = data.checklist[c.key];
              return (
                <div key={c.key} className="flex items-center justify-between rounded-lg border border-lline px-3 py-2 dark:border-line">
                  <span className="flex items-center gap-2 text-[13px]">
                    <span className={done ? 'text-success' : 'text-faint'}>{done ? '✓' : '○'}</span>
                    <span className={done ? 'text-muted line-through' : ''}>{c.label}</span>
                  </span>
                  {!done && <Link to={c.to} className="btn-ghost text-[12px]">{c.cta}</Link>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="mb-2 mt-6 text-[13px] uppercase tracking-[0.12em] text-faint">Recent orders</h2>
      {!data ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : data.recent_orders.length === 0 ? (
        <div className="surface p-10 text-center text-muted">No orders yet. Create your first order to see it here.</div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Charge</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_orders.map((o) => (
                <tr key={o.id} className="border-b border-lline/60 dark:border-line/60">
                  <td className="px-4 py-3 font-medium">{o.recipient.name}<span className="text-muted"> · {o.recipient.city}, {o.recipient.state}</span></td>
                  <td className="px-4 py-3">{dollars(o.wallet_charge_cents)}</td>
                  <td className="px-4 py-3"><FulfillmentBadge order={o} /></td>
                  <td className="px-4 py-3 font-mono text-[12px] text-teal">{o.tracking_number ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/app/orders" className="btn">Orders</Link>
        <Link to="/app/wallet" className="btn-ghost">Wallet</Link>
        <Link to="/app/catalog" className="btn-ghost">Catalog</Link>
        <Link to="/app/tracking" className="btn-ghost">Tracking</Link>
      </div>
    </>
  );
}
