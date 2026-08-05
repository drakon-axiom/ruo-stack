import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fulfillmentState, FULFILLMENT_META } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import type { Address } from './AddressBook.js';

/**
 * A recipient handed to this screen by "Ship again" on Customers. It prefills a
 * NEW order — it is not a link to the old one, exactly like the address-book
 * picker: fields are copied, nothing is referenced.
 */
export interface ShipTo {
  recipient_name: string;
  recipient_email: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface OrderItem { product_id: string; qty: number; unit_wholesale_cents: number }
interface Order {
  id: string;
  status: string;
  blocker: string;
  recipient: { name: string; email: string | null; address1: string; address2: string | null; city: string; state: string; zip: string; country: string };
  wallet_charge_cents: number;
  shipping_service_code: string | null;
  tracking_number: string | null;
  carrier: string | null;
  exported_at: string | null;
  created_at: string;
  items: OrderItem[];
}
interface CatalogProduct { id: string; name: string; dose?: string | null; unit?: string | null; wholesale_cents: number }
interface ShipOption { carrier: string; service: string; service_code: string; amount_cents: number; est_days: number | null }
interface Quote { plan: string; wholesale_cents: number; shipping_source: string; shipping_options: ShipOption[]; recommended_service_code: string }

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

const isEditable = (o: Order) => o.status === 'ready_for_fulfillment' || o.status === 'processing';

type Filter = 'all' | 'ready_for_fulfillment' | 'shipped' | 'delivered' | 'cancelled';

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [prefill, setPrefill] = useState<ShipTo | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  function load() {
    setLoading(true);
    api<{ orders: Order[] }>('/api/brand/orders').then((r) => { setOrders(r.orders); setLoading(false); });
  }
  useEffect(load, []);

  // "Ship again" on Customers routes here with a recipient in history state.
  // Consume it once and strip it, or a refresh — or a Back into this entry —
  // reopens the drawer with a stale address the operator didn't ask for.
  useEffect(() => {
    const shipTo = (location.state as { shipTo?: ShipTo } | null)?.shipTo;
    if (!shipTo) return;
    setPrefill(shipTo);
    setCreating(true);
    navigate('/app/orders', { replace: true, state: null });
  }, [location.state, navigate]);

  function closeDrawer() { setCreating(false); setPrefill(null); }

  const visible = orders.filter((o) => filter === 'all' || o.status === filter);
  const awaiting = orders.filter((o) => o.blocker !== 'none').length;

  return (
    <>
      <div className="mb-1 flex items-end justify-between">
        <div>
          <h1 className="text-[23px] font-bold">Orders</h1>
          <p className="mt-1 text-[13px] text-muted">Enter orders manually; we fulfill under your label and deduct your wallet.</p>
        </div>
        <button className="btn" onClick={() => { setPrefill(null); setCreating(true); }}>+ New manual order</button>
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
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className="border-b border-lline/60 dark:border-line/60">
                  <td className="px-4 py-3 font-medium">{o.recipient.name}<span className="text-muted"> · {o.recipient.city}, {o.recipient.state}</span></td>
                  <td className="px-4 py-3 text-muted">{o.items.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="px-4 py-3">{dollars(o.wallet_charge_cents)}</td>
                  <td className="px-4 py-3"><FulfillmentBadge order={o} /></td>
                  <td className="px-4 py-3 font-mono text-[12px] text-teal">{o.tracking_number ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {isEditable(o) && <button className="btn-ghost text-[12px]" onClick={() => setEditing(o)}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <OrderDrawer prefill={prefill ?? undefined} onClose={closeDrawer} onSaved={() => { closeDrawer(); load(); }} />}
      {editing && <OrderDrawer editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function OrderDrawer({ editing, prefill, onClose, onSaved }: { editing?: Order; prefill?: ShipTo; onClose: () => void; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [lines, setLines] = useState<{ product_id: string; qty: number }[]>(
    editing ? editing.items.map((i) => ({ product_id: i.product_id, qty: i.qty })) : [],
  );
  const [r, setR] = useState(
    editing
      ? {
          recipient_name: editing.recipient.name,
          recipient_email: editing.recipient.email ?? '',
          address1: editing.recipient.address1,
          address2: editing.recipient.address2 ?? '',
          city: editing.recipient.city,
          state: editing.recipient.state,
          zip: editing.recipient.zip,
          country: editing.recipient.country,
        }
      : prefill
        ? {
            recipient_name: prefill.recipient_name,
            recipient_email: prefill.recipient_email ?? '',
            address1: prefill.address1,
            address2: prefill.address2 ?? '',
            city: prefill.city,
            state: prefill.state,
            zip: prefill.zip,
            country: prefill.country,
          }
        : { recipient_name: '', recipient_email: '', address1: '', address2: '', city: '', state: '', zip: '', country: 'US' },
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [service, setService] = useState(editing?.shipping_service_code ?? '');
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmExported, setConfirmExported] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [saveAddress, setSaveAddress] = useState(false);

  useEffect(() => { api<{ products: CatalogProduct[] }>('/api/brand/catalog').then((x) => setCatalog(x.products)); }, []);
  // Address Book: only on new orders (editing keeps the order's captured address).
  useEffect(() => {
    if (editing) return;
    api<{ addresses: Address[] }>('/api/brand/addresses').then((x) => setAddresses(x.addresses)).catch(() => undefined);
  }, [editing]);

  function fillFromAddress(id: string) {
    const a = addresses.find((x) => x.id === id);
    if (!a) return;
    setR({
      recipient_name: a.recipient_name,
      recipient_email: a.recipient_email ?? '',
      address1: a.address1,
      address2: a.address2 ?? '',
      city: a.city,
      state: a.state,
      zip: a.zip,
      country: a.country,
    });
    setSaveAddress(false); // already saved
  }

  const canQuote = lines.length > 0 && r.zip.length >= 5 && r.state.length >= 2;
  const quoteKey = JSON.stringify({ lines, zip: r.zip, state: r.state });
  useEffect(() => {
    if (!canQuote) { setQuote(null); return; }
    let active = true;
    setQuoting(true);
    api<Quote>('/api/brand/orders/quote', { method: 'POST', body: { items: lines, zip: r.zip, state: r.state } })
      .then((q) => { if (active) { setQuote(q); setService((s) => s || q.recommended_service_code); } })
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
    // Editing an already-exported order: warn that changes won't reach ShipStation.
    if (editing?.exported_at && !confirmExported) { setConfirmExported(true); return; }
    setErr('');
    setBusy(true);
    try {
      const body = { items: lines, ...r, recipient_email: r.recipient_email || undefined, service_code: service || undefined };
      if (editing) await api(`/api/brand/orders/${editing.id}`, { method: 'PATCH', body });
      else await api('/api/brand/orders', { method: 'POST', body });
      // Best-effort: persist the recipient to the address book if requested. A
      // failure here must not fail the placed order.
      if (!editing && saveAddress) {
        await api('/api/brand/addresses', {
          method: 'POST',
          body: {
            recipient_name: r.recipient_name,
            recipient_email: r.recipient_email || undefined,
            address1: r.address1,
            address2: r.address2 || undefined,
            city: r.city,
            state: r.state,
            zip: r.zip,
            country: r.country || 'US',
          },
        }).catch(() => undefined);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save order');
      setBusy(false);
      setConfirmExported(false);
    }
  }

  const valid = lines.length > 0 && r.recipient_name && r.address1 && r.city && r.state && r.zip && !!quote;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-lline bg-white dark:border-line dark:bg-bg2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-lline px-5 py-4 dark:border-line">
          <h2 className="text-[16px] font-semibold">{editing ? 'Edit order' : prefill ? 'Ship again' : 'New manual order'}</h2>
          <button onClick={onClose} className="text-faint hover:text-text">✕</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
          {prefill && (
            <div className="rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-[12px] text-teal">
              Shipping again to <span className="font-medium">{prefill.recipient_name}</span>, using the address from their
              most recent order. This is a brand-new order — add products and check the address before you place it.
            </div>
          )}
          {editing?.exported_at && (
            <div className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">
              This order is already at the shipping platform. Edits update your record but won't be pushed to ShipStation automatically — contact support to change the shipment.
            </div>
          )}

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
            {!editing && addresses.length > 0 && (
              <select className="app-input text-muted" defaultValue="" onChange={(e) => { if (e.target.value) fillFromAddress(e.target.value); e.target.value = ''; }}>
                <option value="">📖 Choose from address book…</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>{a.label ? `${a.label} — ` : ''}{a.recipient_name}, {a.city} {a.state}</option>
                ))}
              </select>
            )}
            <input className="app-input" placeholder="Recipient name" value={r.recipient_name} onChange={(e) => setR({ ...r, recipient_name: e.target.value })} />
            <input className="app-input" placeholder="Email (optional)" value={r.recipient_email} onChange={(e) => setR({ ...r, recipient_email: e.target.value })} />
            <input className="app-input" placeholder="Address line 1" value={r.address1} onChange={(e) => setR({ ...r, address1: e.target.value })} />
            <input className="app-input" placeholder="Address line 2 (optional)" value={r.address2} onChange={(e) => setR({ ...r, address2: e.target.value })} />
            <div className="grid grid-cols-3 gap-2">
              <input className="app-input col-span-1" placeholder="City" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} />
              <input className="app-input w-full" placeholder="State" value={r.state} onChange={(e) => setR({ ...r, state: e.target.value })} />
              <input className="app-input w-full" placeholder="ZIP" value={r.zip} onChange={(e) => setR({ ...r, zip: e.target.value })} />
            </div>
            {!editing && (
              <label className="flex cursor-pointer items-center gap-2 pt-1 text-[12px] text-muted">
                <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                Save this address to my address book
              </label>
            )}
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
          <button className="btn w-full" disabled={!valid || busy} onClick={submit}>{busy ? '…' : editing ? 'Save changes' : 'Place order'}</button>
          <p className="mt-2 text-center text-[11px] text-faint">
            {quoting ? 'Fetching live rates…' : !canQuote ? 'Add products + destination to see shipping.' : 'Charged from your wallet when we ship.'}
          </p>
        </div>
      </div>

      {confirmExported && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 px-4" onClick={(e) => { e.stopPropagation(); setConfirmExported(false); }}>
          <div className="surface w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-[15px] font-semibold">Order already sent to shipping</h3>
            <p className="mb-4 text-[13px] text-muted">
              We've already handed this order to the shipping platform. Saving will update your record here, but <span className="font-medium text-text">the change won't be pushed to the shipping platform</span>. To change the actual shipment, contact support.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmExported(false)}>Cancel</button>
              <button className="btn" disabled={busy} onClick={submit}>{busy ? '…' : 'Save anyway'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
