import { useEffect, useMemo, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { EmptyState, Field, PageHeader, StatusPill, Tabs } from '../components/ui.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface Order {
  id: string;
  brand_name: string;
  status: string;
  blocker: string;
  recipient: { name: string; city: string; state: string; zip: string };
  item_count: number;
  wallet_charge_cents: number;
  shipping_service_code: string | null;
  carrier_rated: boolean;
  tracking_number: string | null;
  carrier: string | null;
  label_url: string | null;
  created_at: string;
}

type Filter = 'ready_for_fulfillment' | 'processing' | 'shipped' | 'delivered' | 'all';

export function Fulfillment() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'fulfillment') : false;
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>('ready_for_fulfillment');
  const [shipping, setShipping] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api<{ orders: Order[] }>('/api/admin/orders').then((r) => { setOrders(r.orders); setLoading(false); });
  }
  useEffect(load, []);

  const counts = useMemo(() => ({
    ready_for_fulfillment: orders.filter((o) => o.status === 'ready_for_fulfillment').length,
    processing: orders.filter((o) => o.status === 'processing').length,
    shipped: orders.filter((o) => o.status === 'shipped').length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
    all: orders.length,
  }), [orders]);

  const visible = orders.filter((o) => filter === 'all' || o.status === filter);

  async function deliver(id: string) {
    await api(`/api/admin/orders/${id}/deliver`, { method: 'POST' });
    load();
  }

  return (
    <>
      <PageHeader title="Fulfillment Queue" subtitle="Orders across all brands. Shipping captures the brand's wallet." />

      <div className="mb-3">
        <Tabs<Filter>
          active={filter}
          onChange={setFilter}
          tabs={[
            { key: 'ready_for_fulfillment', label: 'Ready', count: counts.ready_for_fulfillment },
            { key: 'processing', label: 'Processing', count: counts.processing },
            { key: 'shipped', label: 'Shipped', count: counts.shipped },
            { key: 'delivered', label: 'Delivered', count: counts.delivered },
            { key: 'all', label: 'All', count: counts.all },
          ]}
        />
      </div>

      {loading ? (
        <div className="card p-10 text-center text-muted">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing here" hint="No orders in this state." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Ship to</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Charge</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className="border-b border-line/60">
                  <td className="px-4 py-3 text-text">{o.brand_name}</td>
                  <td className="px-4 py-3 text-muted">{o.recipient.name} · {o.recipient.city}, {o.recipient.state} {o.recipient.zip}</td>
                  <td className="px-4 py-3">{o.item_count}</td>
                  <td className="px-4 py-3">{dollars(o.wallet_charge_cents)}</td>
                  <td className="px-4 py-3">
                    <StatusPill value={o.status} />
                    {o.blocker !== 'none' && <span className="ml-1 pill border-amber/40 bg-amber/10 text-amber">{o.blocker.replace(/_/g, ' ')}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {writable && (o.status === 'ready_for_fulfillment' || o.status === 'processing') && (
                      <button className="btn" onClick={() => setShipping(o)}>Ship</button>
                    )}
                    {writable && o.status === 'shipped' && (
                      <button className="btn-ghost" onClick={() => deliver(o.id)}>Mark delivered</button>
                    )}
                    {o.status === 'shipped' && (
                      <div className="mt-1 flex items-center justify-end gap-2">
                        <span className="font-mono text-[11px] text-teal-bright">{o.carrier} {o.tracking_number}</span>
                        {o.label_url && <a className="text-[11px] text-teal underline" href={o.label_url} target="_blank" rel="noreferrer">label</a>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shipping && <ShipModal order={shipping} onClose={() => setShipping(null)} onShipped={() => { setShipping(null); load(); }} />}
    </>
  );
}

function ShipModal({ order, onClose, onShipped }: { order: Order; onClose: () => void; onShipped: () => void }) {
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('USPS');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function ship(buyLabel: boolean) {
    setErr('');
    setBusy(true);
    try {
      const body = buyLabel ? undefined : { tracking_number: tracking, carrier };
      await api(`/api/admin/orders/${order.id}/ship`, { method: 'POST', body });
      onShipped();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Ship failed');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-[16px] font-semibold text-text">Ship order</h2>
        <p className="mb-4 text-[12px] text-muted">{order.brand_name} → {order.recipient.name}. Shipping captures {dollars(order.wallet_charge_cents)} from the brand's wallet.</p>
        {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}

        {order.carrier_rated ? (
          <>
            <p className="mb-4 rounded-lg border border-line bg-card2 px-3 py-2 text-[12px] text-muted">
              Buys a <span className="text-text">{order.shipping_service_code?.replace(/_/g, ' ')}</span> label via ShipStation and captures the tracking number automatically.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={busy} onClick={() => ship(true)}>{busy ? '…' : 'Buy label & ship'}</button>
            </div>
            <p className="mt-3 text-center text-[11px] text-faint">Or enter a tracking number manually below.</p>
            <div className="mt-2 flex gap-2">
              <input className="input flex-1" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="manual tracking #" />
              <button className="btn-ghost" disabled={!tracking || busy} onClick={() => ship(false)}>Use manual</button>
            </div>
          </>
        ) : (
          <>
            <Field label="Carrier">
              <select className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                <option>USPS</option><option>UPS</option><option>FedEx</option>
              </select>
            </Field>
            <Field label="Tracking number">
              <input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 9400 1000 0000 0000 0000 00" />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={!tracking || busy} onClick={() => ship(false)}>{busy ? '…' : 'Capture & ship'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
