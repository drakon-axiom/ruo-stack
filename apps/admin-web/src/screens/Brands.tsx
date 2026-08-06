import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Drawer, EmptyState, Field, PageHeader, StatusPill, buttonClass, cardClass, inputClass, pillClass } from '@ruostack/ui';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const PLAN_PILL: Record<string, string> = {
  starter: 'border-line-strong bg-surface-3 text-content-muted',
  pro: 'border-accent/40 bg-accent/10 text-accent',
  volume: 'border-accent/40 bg-accent/10 text-accent-hover',
};

interface BrandRow {
  id: string;
  brand_name: string;
  status: 'active' | 'suspended';
  plan: string;
  member_since: string;
  balance_cents: number;
}

export function Brands() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api<{ brands: BrandRow[] }>('/api/admin/brands').then((r) => { setBrands(r.brands); setLoading(false); });
  }
  useEffect(load, []);

  return (
    <>
      <PageHeader title="Brand Manager" subtitle="Every brand — plan, wallet, and status." />

      {loading ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>
      ) : brands.length === 0 ? (
        <EmptyState title="No brands yet" hint="Brands appear here as they sign up." />
      ) : (
        <div className={cardClass('overflow-hidden')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs uppercase tracking-wide text-content-faint">
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Wallet</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Member since</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id} onClick={() => setOpenId(b.id)} className="cursor-pointer border-b border-line/60 hover:bg-surface-3">
                  <td className="px-4 py-3 text-content">{b.brand_name}</td>
                  <td className="px-4 py-3"><span className={pillClass(`${PLAN_PILL[b.plan]}`)}>{b.plan}</span></td>
                  <td className="px-4 py-3">{dollars(b.balance_cents)}</td>
                  <td className="px-4 py-3"><StatusPill value={b.status} /></td>
                  <td className="px-4 py-3 text-content-muted">{new Date(b.member_since).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <BrandDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}

interface Detail {
  id: string;
  brand_name: string;
  status: 'active' | 'suspended';
  owner_email: string | null;
  member_since: string;
  referral_code: string;
  subscription: { plan: string; status: string; cancel_at_period_end: boolean; current_period_end: string | null };
  wallet: { balance_cents: number; held_cents: number; available_cents: number };
  shipping: { pickpack_fee_override_cents: number | null; pickpack_fee_effective_cents: number; global_default_cents: number; markup_cents: number };
  orders: { id: string; status: string; recipient_name: string; wallet_charge_cents: number }[];
  ledger: { id: string; type: string; amount_cents: number; balance_after_cents: number; reason: string | null; created_at: string }[];
}

function BrandDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { claims } = useAuth();
  const isSuper = claims?.role === 'super_admin';
  const canAdjust = isSuper || claims?.role === 'finance';
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [adjAmt, setAdjAmt] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [fee, setFee] = useState('');

  function load() { api<Detail>(`/api/admin/brands/${id}`).then(setD); }
  useEffect(load, [id]);
  useEffect(() => {
    if (d) setFee(d.shipping.pickpack_fee_override_cents != null ? (d.shipping.pickpack_fee_override_cents / 100).toFixed(2) : '');
  }, [d]);

  async function savePickpack(clear: boolean) {
    setErr(''); setBusy(true);
    try {
      const cents = clear ? null : Math.max(0, Math.round(parseFloat(fee || '0') * 100));
      await api(`/api/admin/brands/${id}/shipping`, { method: 'PATCH', body: { pickpack_fee_override_cents: cents } });
      load(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function toggleStatus() {
    if (!d) return;
    setErr('');
    setBusy(true);
    try {
      const next = d.status === 'active' ? 'suspended' : 'active';
      await api(`/api/admin/brands/${id}/status`, { method: 'PATCH', body: { status: next } });
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    setErr('');
    setBusy(true);
    try {
      const cents = Math.round(parseFloat(adjAmt || '0') * 100);
      await api(`/api/admin/brands/${id}/wallet/adjust`, { method: 'POST', body: { amount_cents: cents, reason: adjReason } });
      setAdjAmt(''); setAdjReason('');
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Adjustment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open title={d?.brand_name ?? 'Brand'} onOpenChange={(o) => { if (!o) onClose(); }}>
      {!d ? <div className="text-content-muted">Loading…</div> : (
        <div className="space-y-4 text-sm">
          {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{err}</div>}

          <div className="flex items-center gap-2">
            <StatusPill value={d.status} />
            <span className={pillClass()}>{d.subscription.plan}</span>
            {d.owner_email && <span className="text-content-muted">{d.owner_email}</span>}
          </div>

          <div className={cardClass('p-3')}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-xl font-extrabold text-accent">{dollars(d.wallet.available_cents)}</div><div className="text-2xs text-content-faint">available</div></div>
              <div><div className="text-xl font-extrabold">{dollars(d.wallet.held_cents)}</div><div className="text-2xs text-content-faint">held</div></div>
              <div><div className="text-xl font-extrabold">{dollars(d.wallet.balance_cents)}</div><div className="text-2xs text-content-faint">balance</div></div>
            </div>
          </div>

          {isSuper && (
            <button className={d.status === 'active' ? 'btn-danger w-full' : 'btn w-full'} onClick={toggleStatus} disabled={busy}>
              {d.status === 'active' ? 'Suspend brand' : 'Reactivate brand'}
            </button>
          )}

          {canAdjust && (
            <div className={cardClass('p-3')}>
              <div className="mb-2 text-2xs uppercase tracking-[0.1em] text-content-faint">Manual wallet adjustment (Finance)</div>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <Field label="Amount $ (+/-)"><input className={inputClass()} value={adjAmt} onChange={(e) => setAdjAmt(e.target.value)} placeholder="-25 or 50" /></Field>
                <Field label="Reason"><input className={inputClass()} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} /></Field>
              </div>
              <button className={buttonClass('ghost', 'md', 'w-full')} disabled={busy || !adjAmt || !adjReason} onClick={adjust}>Apply adjustment</button>
            </div>
          )}

          {canAdjust && (
            <div className={cardClass('p-3')}>
              <div className="mb-1 text-2xs uppercase tracking-[0.1em] text-content-faint">Pick-&amp;-pack fee override (Finance)</div>
              <div className="mb-2 text-xs text-content-muted">
                Effective <span className="text-content">{dollars(d.shipping.pickpack_fee_effective_cents)}</span>/shipment
                {d.shipping.pickpack_fee_override_cents == null ? ' (global default)' : ' (override)'} · global {dollars(d.shipping.global_default_cents)}
              </div>
              <div className="flex items-end gap-2">
                <Field label="Override $/shipment"><input className={inputClass()} value={fee} onChange={(e) => setFee(e.target.value)} placeholder={(d.shipping.global_default_cents / 100).toFixed(2)} /></Field>
                <button className={buttonClass('primary', 'md')} disabled={busy || !fee} onClick={() => savePickpack(false)}>Save</button>
                <button className={buttonClass('ghost', 'md')} disabled={busy || d.shipping.pickpack_fee_override_cents == null} onClick={() => savePickpack(true)}>Use global</button>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-2xs uppercase tracking-[0.1em] text-content-faint">Recent orders</div>
            {d.orders.length === 0 ? <p className="text-content-muted">None</p> : d.orders.map((o) => (
              <div key={o.id} className="flex justify-between border-b border-line/50 py-1.5">
                <span>{o.recipient_name} <span className={pillClass('ml-1')}>{o.status.replace(/_/g, ' ')}</span></span>
                <span>{dollars(o.wallet_charge_cents)}</span>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-2xs uppercase tracking-[0.1em] text-content-faint">Wallet ledger</div>
            {d.ledger.length === 0 ? <p className="text-content-muted">None</p> : d.ledger.map((e) => (
              <div key={e.id} className="flex justify-between border-b border-line/50 py-1.5">
                <span className="text-content-muted">{e.type.replace(/_/g, ' ')}{e.reason ? ` · ${e.reason}` : ''}</span>
                <span className={e.amount_cents >= 0 ? 'text-success' : 'text-danger'}>{e.amount_cents >= 0 ? '+' : ''}{dollars(e.amount_cents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
