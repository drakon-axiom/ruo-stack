import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface Order {
  id: string;
  blocker: string;
  recipient: { name: string; city: string; state: string };
  wallet_charge_cents: number;
  created_at: string;
}

const BLOCKER_LABEL: Record<string, string> = {
  awaiting_funds: 'Awaiting funds',
  needs_address: 'Needs address',
  needs_customer_info: 'Needs customer info',
};

export function ActionRequired() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ orders: Order[] }>('/api/brand/orders?blocked=true').then((r) => { setOrders(r.orders); setLoading(false); });
  }, []);

  const totalNeeded = orders.filter((o) => o.blocker === 'awaiting_funds').reduce((s, o) => s + o.wallet_charge_cents, 0);

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">Action Required</h1>
      <p className="mb-5 text-[13px] text-muted">Orders blocked from fulfillment until you resolve them.</p>

      {loading ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="surface p-10 text-center text-muted">Nothing needs attention. 🎉</div>
      ) : (
        <>
          {totalNeeded > 0 && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-amber/40 bg-amber/10 px-4 py-3">
              <span className="text-[13px] text-amber">{dollars(totalNeeded)} needed to fulfill {orders.length} blocked order{orders.length > 1 ? 's' : ''}.</span>
              <Link to="/app/wallet" className="btn">Add funds</Link>
            </div>
          )}
          <div className="surface overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Charge</th>
                  <th className="px-4 py-3">Blocker</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-lline/60 dark:border-line/60">
                    <td className="px-4 py-3 font-medium">{o.recipient.name}<span className="text-muted"> · {o.recipient.city}, {o.recipient.state}</span></td>
                    <td className="px-4 py-3">{dollars(o.wallet_charge_cents)}</td>
                    <td className="px-4 py-3"><span className="pill border-amber/40 bg-amber/10 text-amber">{BLOCKER_LABEL[o.blocker] ?? o.blocker}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
