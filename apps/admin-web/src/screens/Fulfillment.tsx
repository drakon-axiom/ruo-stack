import { useEffect, useMemo, useState } from 'react';
import { canWrite, fulfillmentState, FULFILLMENT_META } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Drawer, EmptyState, Field, PageHeader, Tabs } from '../components/ui.js';

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
  tracking_number: string | null;
  carrier: string | null;
  exported_at: string | null;
  created_at: string;
}

const TONE: Record<string, string> = {
  amber: 'border-amber/40 bg-amber/10 text-amber',
  slate: 'border-line2 bg-card2 text-muted',
  teal: 'border-teal/40 bg-teal/10 text-teal',
  success: 'border-success/40 bg-success/10 text-success',
  muted: 'border-line2 bg-card2 text-muted',
};

function FulfillmentBadge({ order }: { order: { status: string; blocker: string; exported_at: string | null } }) {
  const meta = FULFILLMENT_META[fulfillmentState(order)];
  return <span className={`pill ${TONE[meta.tone]}`} title={meta.label}>{meta.icon} {meta.label}</span>;
}

const isPreShip = (o: Order) => o.status === 'ready_for_fulfillment' || o.status === 'processing';

type Filter = 'ready_for_fulfillment' | 'processing' | 'shipped' | 'delivered' | 'all';

export function Fulfillment() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'fulfillment') : false;
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>('ready_for_fulfillment');
  const [shipping, setShipping] = useState<Order | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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
  async function resend(id: string) {
    setBusyId(id);
    try { await api(`/api/admin/orders/${id}/resend`, { method: 'POST' }); load(); }
    finally { setBusyId(null); }
  }

  return (
    <>
      <PageHeader title="Fulfillment Monitor" subtitle="Orders flow to ShipStation for fulfillment; tracking flows back via shipnotify. Failsafes below for exceptions." />

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
                  <td className="px-4 py-3"><FulfillmentBadge order={o} /></td>
                  <td className="px-4 py-3 text-right">
                    {writable && isPreShip(o) && (
                      <div className="flex items-center justify-end gap-1.5">
                        <button className="btn-ghost text-[12px]" onClick={() => setEditing(o)}>Edit</button>
                        <button className="btn-ghost text-[12px]" disabled={busyId === o.id} onClick={() => resend(o.id)} title="Re-queue for ShipStation's next export pull">
                          {busyId === o.id ? '…' : o.exported_at ? 'Re-send' : 'Send'}
                        </button>
                        <button className="btn" onClick={() => setShipping(o)} title="Manually mark shipped (failsafe)">Mark shipped</button>
                      </div>
                    )}
                    {writable && o.status === 'shipped' && (
                      <button className="btn-ghost" onClick={() => deliver(o.id)}>Mark delivered</button>
                    )}
                    {o.status === 'shipped' && o.tracking_number && (
                      <div className="mt-1 font-mono text-[11px] text-teal-bright">{o.carrier} {o.tracking_number}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shipping && <ShipModal order={shipping} onClose={() => setShipping(null)} onShipped={() => { setShipping(null); load(); }} />}
      {editing && <EditDrawer order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

// Manual mark-shipped failsafe — no label buying; records tracking + captures wallet.
function ShipModal({ order, onClose, onShipped }: { order: Order; onClose: () => void; onShipped: () => void }) {
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('USPS');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function ship() {
    setErr('');
    setBusy(true);
    try {
      await api(`/api/admin/orders/${order.id}/ship`, { method: 'POST', body: { tracking_number: tracking, carrier } });
      onShipped();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Ship failed');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-[16px] font-semibold text-text">Mark shipped (manual)</h2>
        <p className="mb-4 text-[12px] text-muted">{order.brand_name} → {order.recipient.name}. Captures {dollars(order.wallet_charge_cents)} from the brand's wallet. Use only when ShipStation's shipnotify didn't arrive.</p>
        {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
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
          <button className="btn" disabled={!tracking || busy} onClick={ship}>{busy ? '…' : 'Capture & ship'}</button>
        </div>
      </div>
    </div>
  );
}

interface OrderDetail {
  id: string;
  recipient: { name: string; email: string | null; phone: string | null; address1: string; address2: string | null; city: string; state: string; zip: string; country: string };
  shipping_service_code: string | null;
  wallet_charge_cents: number;
  exported_at: string | null;
  items: { product_id: string; qty: number; unit_wholesale_cents: number }[];
}
interface AdminProduct { id: string; name: string }

// Admin pre-ship edit — re-prices + re-reserves on save (server-side).
function EditDrawer({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [catalog, setCatalog] = useState<AdminProduct[]>([]);
  const [lines, setLines] = useState<{ product_id: string; qty: number }[]>([]);
  const [r, setR] = useState({ recipient_name: '', recipient_email: '', recipient_phone: '', address1: '', address2: '', city: '', state: '', zip: '', country: 'US' });
  const [service, setService] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<OrderDetail>(`/api/admin/orders/${order.id}`).then((d) => {
      setDetail(d);
      setLines(d.items.map((i) => ({ product_id: i.product_id, qty: i.qty })));
      setR({
        recipient_name: d.recipient.name,
        recipient_email: d.recipient.email ?? '',
        recipient_phone: d.recipient.phone ?? '',
        address1: d.recipient.address1,
        address2: d.recipient.address2 ?? '',
        city: d.recipient.city,
        state: d.recipient.state,
        zip: d.recipient.zip,
        country: d.recipient.country,
      });
      setService(d.shipping_service_code ?? '');
    });
    api<{ products: AdminProduct[] }>('/api/admin/catalog').then((x) => setCatalog(x.products));
  }, [order.id]);

  function setLine(i: number, patch: Partial<{ product_id: string; qty: number }>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() { if (catalog[0]) setLines([...lines, { product_id: catalog[0].id, qty: 1 }]); }

  async function save() {
    setErr('');
    setBusy(true);
    try {
      await api(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { items: lines, ...r, recipient_email: r.recipient_email || undefined, recipient_phone: r.recipient_phone || undefined, service_code: service || undefined },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  const valid = lines.length > 0 && r.recipient_name && r.address1 && r.city && r.state && r.zip;

  return (
    <Drawer
      open
      title={`Edit order · ${order.brand_name}`}
      onClose={onClose}
      footer={
        <button className="btn w-full" disabled={!valid || busy || !detail} onClick={save}>{busy ? '…' : 'Save changes (re-prices wallet)'}</button>
      }
    >
      {!detail ? (
        <div className="p-6 text-center text-muted">Loading…</div>
      ) : (
        <div className="space-y-4">
          {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
          {detail.exported_at && (
            <div className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">
              Already at ShipStation. Saving updates the record but won't push to the shipping platform — use <span className="font-medium">Re-send</span> afterward to re-queue it.
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label">Products</span>
              <button className="text-[12px] text-teal" onClick={addLine}>+ Add product</button>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <select className="input flex-1" value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
                  {catalog.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input className="input w-16" type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: Math.max(1, +e.target.value) })} />
                <button className="text-faint hover:text-danger" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <span className="label">Ship to</span>
            <input className="input" placeholder="Recipient name" value={r.recipient_name} onChange={(e) => setR({ ...r, recipient_name: e.target.value })} />
            <input className="input" placeholder="Email (optional)" value={r.recipient_email} onChange={(e) => setR({ ...r, recipient_email: e.target.value })} />
            <input className="input" placeholder="Phone (optional)" value={r.recipient_phone} onChange={(e) => setR({ ...r, recipient_phone: e.target.value })} />
            <input className="input" placeholder="Address line 1" value={r.address1} onChange={(e) => setR({ ...r, address1: e.target.value })} />
            <input className="input" placeholder="Address line 2 (optional)" value={r.address2} onChange={(e) => setR({ ...r, address2: e.target.value })} />
            <div className="grid grid-cols-3 gap-2">
              <input className="input" placeholder="City" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} />
              <input className="input" placeholder="State" value={r.state} onChange={(e) => setR({ ...r, state: e.target.value })} />
              <input className="input" placeholder="ZIP" value={r.zip} onChange={(e) => setR({ ...r, zip: e.target.value })} />
            </div>
          </div>

          <Field label="Shipping service code (optional override)">
            <input className="input" placeholder="leave blank to auto-rate" value={service} onChange={(e) => setService(e.target.value)} />
          </Field>
        </div>
      )}
    </Drawer>
  );
}
