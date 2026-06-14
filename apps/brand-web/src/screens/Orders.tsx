import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface OrderItem { product_id: string; qty: number; unit_wholesale_cents: number }
interface Order {
  id: string;
  status: string;
  blocker: string;
  recipient: { name: string; city: string; state: string };
  wallet_charge_cents: number;
  tracking_number: string | null;
  created_at: string;
  items: OrderItem[];
}
interface CatalogProduct { id: string; name: string; dose?: string | null; unit?: string | null; wholesale_cents: number }
interface ShipOption { carrier: string; service: string; service_code: string; amount_cents: number; est_days: number | null }
interface Quote { plan: string; wholesale_cents: number; shipping_source: string; shipping_options: ShipOption[]; recommended_service_code: string }

const STATUS_PILL: Record<string, string> = {
  ready_for_fulfillment: 'border-amber/40 bg-amber/10 text-amber',
  processing: 'border-amber/40 bg-amber/10 text-amber',
  shipped: 'border-teal/40 bg-teal/10 text-teal',
  delivered: 'border-success/40 bg-success/10 text-success',
  cancelled: 'border-line2 bg-card2 text-muted',
};

type Filter = 'all' | 'ready_for_fulfillment' | 'shipped' | 'delivered' | 'cancelled';

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api<{ orders: Order[] }>('/api/brand/orders').then((r) => { setOrders(r.orders); setLoading(false); });
  }
  useEffect(load, []);

  const visible = orders.filter((o) => filter === 'all' || o.status === filter);
  const awaiting = orders.filter((o) => o.blocker !== 'none').length;

  return (
    <>
      <div className="mb-1 flex items-end justify-between">
        <div>
          <h1 className="text-[23px] font-bold">Orders</h1>
          <p className="mt-1 text-[13px] text-muted">Enter orders manually; we fulfill under your label and deduct your wallet.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>+ New manual order</button>
      </div>

      {awaiting > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-amber/40 bg-amber/10 px-4 py-3">
          <span className="text-[13px] text-amber">{awaiting} order{awaiting > 1 ? 's' : ''} need attention (awaiting funds).</span>
          <Link to="/app/action-required" className="btn">Review</Link>
        </div>
      )}

      <div className="mt-5 grid grid-cols-4 gap-3">
        {(['all', 'ready_for_fulfillment', 'shipped', 'delivered'] as const).map((k) => (
          <div key={k} className="surface p-3.5">
            <div className="text-[22px] font-extrabold">{k === 'all' ? orders.length : orders.filter((o) => o.status === k).length}</div>
            <div className="text-[12px] text-muted">{k === 'all' ? 'Total' : k.replace(/_/g, ' ')}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 mt-5 flex flex-wrap gap-2">
        {(['all', 'ready_for_fulfillment', 'shipped', 'delivered', 'cancelled'] as Filter[]).map((k) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-pill border px-3 py-1 text-[12.5px] ${filter === k ? 'border-teal bg-teal text-white' : 'border-lline text-muted dark:border-line2'}`}>
            {k === 'all' ? 'All' : k.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="surface p-10 text-center text-muted">No orders yet. Create your first manual order.</div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Charge</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className="border-b border-lline/60 dark:border-line/60">
                  <td className="px-4 py-3 font-medium">{o.recipient.name}<span className="text-muted"> · {o.recipient.city}, {o.recipient.state}</span></td>
                  <td className="px-4 py-3 text-muted">{o.items.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="px-4 py-3">{dollars(o.wallet_charge_cents)}</td>
                  <td className="px-4 py-3">
                    <span className={`pill ${STATUS_PILL[o.status]}`}>{o.status.replace(/_/g, ' ')}</span>
                    {o.blocker !== 'none' && <span className="ml-1 pill border-amber/40 bg-amber/10 text-amber">{o.blocker.replace(/_/g, ' ')}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-teal">{o.tracking_number ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <NewOrder onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </>
  );
}

function NewOrder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [lines, setLines] = useState<{ product_id: string; qty: number }[]>([]);
  const [r, setR] = useState({ recipient_name: '', recipient_email: '', address1: '', address2: '', city: '', state: '', zip: '', country: 'US' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [service, setService] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ products: CatalogProduct[] }>('/api/brand/catalog').then((x) => setCatalog(x.products)); }, []);

  // Fetch live shipping rates when items + destination are ready.
  const canQuote = lines.length > 0 && r.zip.length >= 5 && r.state.length >= 2;
  const quoteKey = JSON.stringify({ lines, zip: r.zip, state: r.state });
  useEffect(() => {
    if (!canQuote) { setQuote(null); return; }
    let active = true;
    setQuoting(true);
    api<Quote>('/api/brand/orders/quote', { method: 'POST', body: { items: lines, zip: r.zip, state: r.state } })
      .then((q) => { if (active) { setQuote(q); setService(q.recommended_service_code); } })
      .catch(() => { if (active) setQuote(null); })
      .finally(() => { if (active) setQuoting(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const selected = quote?.shipping_options.find((o) => o.service_code === service) ?? quote?.shipping_options[0];
  const wholesale = quote?.wholesale_cents ?? 0;
  const shipping = selected?.amount_cents ?? 0;
  const charge = quote ? wholesale + shipping : 0;

  function addLine() { if (catalog[0]) setLines([...lines, { product_id: catalog[0].id, qty: 1 }]); }
  function setLine(i: number, patch: Partial<{ product_id: string; qty: number }>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      await api('/api/brand/orders', { method: 'POST', body: { items: lines, ...r, recipient_email: r.recipient_email || undefined, service_code: service || undefined } });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not create order');
      setBusy(false);
    }
  }

  const valid = lines.length > 0 && r.recipient_name && r.address1 && r.city && r.state && r.zip && !!quote;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-lline bg-white dark:border-line dark:bg-bg2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-lline px-5 py-4 dark:border-line">
          <h2 className="text-[16px] font-semibold">New manual order</h2>
          <button onClick={onClose} className="text-faint hover:text-text">✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label">Products</span>
              <button className="text-[12px] text-teal" onClick={addLine}>+ Add product</button>
            </div>
            {lines.length === 0 && <p className="text-[12px] text-faint">Add at least one product.</p>}
            {lines.map((l, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <select className="app-input flex-1" value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
                  {catalog.map((p) => <option key={p.id} value={p.id}>{p.name} — {dollars(p.wholesale_cents)}</option>)}
                </select>
                <input className="app-input w-16" type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: Math.max(1, +e.target.value) })} />
                <button className="text-faint hover:text-danger" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <span className="label">Ship to</span>
            <input className="app-input" placeholder="Recipient name" value={r.recipient_name} onChange={(e) => setR({ ...r, recipient_name: e.target.value })} />
            <input className="app-input" placeholder="Email (optional)" value={r.recipient_email} onChange={(e) => setR({ ...r, recipient_email: e.target.value })} />
            <input className="app-input" placeholder="Address line 1" value={r.address1} onChange={(e) => setR({ ...r, address1: e.target.value })} />
            <input className="app-input" placeholder="Address line 2 (optional)" value={r.address2} onChange={(e) => setR({ ...r, address2: e.target.value })} />
            <div className="grid grid-cols-3 gap-2">
              <input className="app-input col-span-1" placeholder="City" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} />
              <input className="app-input w-full" placeholder="State" value={r.state} onChange={(e) => setR({ ...r, state: e.target.value })} />
              <input className="app-input w-full" placeholder="ZIP" value={r.zip} onChange={(e) => setR({ ...r, zip: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="border-t border-lline px-5 py-4 dark:border-line">
          {quote && quote.shipping_options.length > 1 && (
            <div className="mb-3">
              <span className="label mb-1 block">Shipping {quote.shipping_source !== 'flat' ? '(live)' : ''}</span>
              <div className="space-y-1">
                {quote.shipping_options.map((o) => (
                  <label key={o.service_code} className="flex cursor-pointer items-center justify-between rounded-lg border border-lline px-2 py-1.5 text-[12px] dark:border-line">
                    <span className="flex items-center gap-2">
                      <input type="radio" checked={service === o.service_code} onChange={() => setService(o.service_code)} />
                      {o.carrier} {o.service}{o.est_days ? ` · ~${o.est_days}d` : ''}
                    </span>
                    <span>{dollars(o.amount_cents)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="mb-3 space-y-1 text-[13px]">
            <div className="flex justify-between text-muted"><span>Wholesale</span><span>{dollars(wholesale)}</span></div>
            <div className="flex justify-between text-muted"><span>Shipping{quote && quote.shipping_source !== 'flat' ? ' (live)' : ''}</span><span>{quote ? dollars(shipping) : '—'}</span></div>
            <div className="flex justify-between font-semibold"><span>Wallet charge</span><span>{quote ? dollars(charge) : '—'}</span></div>
          </div>
          <button className="btn w-full" disabled={!valid || busy} onClick={submit}>{busy ? '…' : 'Place order'}</button>
          <p className="mt-2 text-center text-[11px] text-faint">
            {quoting ? 'Fetching live rates…' : !canQuote ? 'Add products + destination to see shipping.' : 'Charged from your wallet when we ship.'}
          </p>
        </div>
      </div>
    </div>
  );
}
