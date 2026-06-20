import { useEffect, useState } from 'react';
import { CLAIM_TYPES, claimTypeLabel, type ClaimType } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';

interface Order { id: string; status: string; recipient: { name: string; city: string; state: string }; tracking_number: string | null }
interface Claim { id: string; order_id: string; type: ClaimType; status: string; resolution: string | null; reason: string | null; amount_cents: number | null; recipient_name: string; created_at: string }

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const STATUS_PILL: Record<string, string> = {
  open: 'border-amber/40 bg-amber/10 text-amber',
  investigating: 'border-teal/40 bg-teal/10 text-teal',
  carrier_filed: 'border-teal/40 bg-teal/10 text-teal',
  resolved: 'border-success/40 bg-success/10 text-success',
};

export function Claims() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [filing, setFiling] = useState(false);

  function load() {
    api<{ orders: Order[] }>('/api/brand/orders').then((r) => setOrders(r.orders.filter((o) => o.status === 'shipped' || o.status === 'delivered')));
    api<{ claims: Claim[] }>('/api/brand/claims').then((r) => setClaims(r.claims));
  }
  useEffect(load, []);

  return (
    <>
      <div className="mb-1 flex items-end justify-between">
        <div>
          <h1 className="text-[23px] font-bold">Claims</h1>
          <p className="mt-1 text-[13px] text-muted">Report a lost, damaged, or wrong shipment. We triage with the carrier and resolve with a reship or wallet credit.</p>
        </div>
        {orders.length > 0 && <button className="btn" onClick={() => setFiling(true)}>File a claim</button>}
      </div>

      {claims.length === 0 ? (
        <div className="surface mt-5 p-10 text-center text-muted">No claims yet.</div>
      ) : (
        <div className="surface mt-5 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                <th className="px-4 py-3">Type</th><th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Filed</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="border-b border-lline/60 dark:border-line/60">
                  <td className="px-4 py-3">{claimTypeLabel(c.type)}</td>
                  <td className="px-4 py-3 text-muted">{c.recipient_name}</td>
                  <td className="px-4 py-3"><span className={`pill ${STATUS_PILL[c.status] ?? ''}`}>{c.status.replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-3 text-muted">{c.resolution ? `${c.resolution}${c.amount_cents ? ` · ${dollars(c.amount_cents)}` : ''}` : '—'}</td>
                  <td className="px-4 py-3 text-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filing && <FileClaim orders={orders} onClose={() => setFiling(false)} onSaved={() => { setFiling(false); load(); }} />}
    </>
  );
}

function FileClaim({ orders, onClose, onSaved }: { orders: Order[]; onClose: () => void; onSaved: () => void }) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');
  const [type, setType] = useState<ClaimType>('damaged');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const photoList = photos.split('\n').map((s) => s.trim()).filter(Boolean);
      await api(`/api/brand/orders/${orderId}/claims`, { method: 'POST', body: { type, description: description || undefined, photos: photoList } });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not file the claim'); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div className="surface w-full max-w-md space-y-3 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold">File a claim</h2>
        {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
        <div>
          <label className="label">Order</label>
          <select className="app-input" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            {orders.map((o) => <option key={o.id} value={o.id}>{o.recipient.name} · {o.recipient.city}, {o.recipient.state}{o.tracking_number ? ` · ${o.tracking_number}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="label">What happened?</label>
          <select className="app-input" value={type} onChange={(e) => setType(e.target.value as ClaimType)}>
            {CLAIM_TYPES.map((t) => <option key={t} value={t}>{claimTypeLabel(t)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Details</label>
          <textarea className="app-input min-h-[70px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the issue" />
        </div>
        <div>
          <label className="label">Photo URLs {type === 'damaged' && <span className="text-amber">(required for damage)</span>}</label>
          <textarea className="app-input min-h-[50px] font-mono text-[12px]" value={photos} onChange={(e) => setPhotos(e.target.value)} placeholder="https://… (one per line)" />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !orderId} onClick={submit}>{busy ? '…' : 'Submit claim'}</button>
        </div>
      </div>
    </div>
  );
}
