import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { ManagedProducts, ProvisioningWizard } from '../components/ProvisioningWizard.js';

interface ManualSetup { webhook_url: string | null; webhook_secret: string; topics: string[] }
interface Connection {
  id: string;
  store_url: string;
  status: string;
  last_error: string | null;
  last_order_at: string | null;
  auto_webhooks: boolean;
  webhook_url: string | null;
  connected_at: string;
}
interface StoreState { plan_allows: boolean; connection: Connection | null }

const STATUS_PILL: Record<string, string> = {
  active: 'border-success/40 bg-success/10 text-success',
  error: 'border-danger/40 bg-danger/10 text-danger',
  disabled: 'border-line2 bg-card2 text-muted',
};

export function Store() {
  const [state, setState] = useState<StoreState | null>(null);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState<ManualSetup | null>(null);
  // Connecting the store, setting the markup and pushing products are all
  // owner-only server-side — don't show staff controls that will 403.
  const [isOwner, setIsOwner] = useState(false);

  function load() {
    setLoading(true);
    api<StoreState>('/api/brand/store').then((s) => { setState(s); setLoading(false); });
  }
  useEffect(load, []);
  useEffect(() => {
    api<{ membership: { role: string } }>('/api/brand/me')
      .then((r) => setIsOwner(r.membership.role === 'owner'))
      .catch(() => setIsOwner(false));
  }, []);

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">My Store</h1>
      <p className="mb-5 text-[13px] text-muted">Connect your WooCommerce store. Orders flow into RUOStack automatically; tracking is written back when we ship.</p>

      {loading || !state ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : !state.plan_allows ? (
        <Upsell />
      ) : state.connection ? (
        <>
          <Connected conn={state.connection} onChanged={() => { setManual(null); load(); }} />
          {isOwner && <ShippingMarkup />}
          {isOwner ? (
            <ProvisioningWizard />
          ) : (
            <div className="surface mt-4 p-6 text-[13px] text-muted">
              Only an owner can add products to your store or change shipping rates. You can still see what’s already
              synced below.
            </div>
          )}
          <ManagedProducts />
        </>
      ) : isOwner ? (
        <ConnectForm onConnected={(m) => { setManual(m); load(); }} />
      ) : (
        <div className="surface p-10 text-center text-muted">
          No store is connected yet. Ask an owner to connect it.
        </div>
      )}

      {manual && <ManualSetupCard setup={manual} onDismiss={() => setManual(null)} />}
    </>
  );
}

function ShippingMarkup() {
  const [cfg, setCfg] = useState<{ markup_cents: number; pickpack_fee_cents: number } | null>(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<{ markup_cents: number; pickpack_fee_cents: number }>('/api/brand/store/shipping').then((c) => { setCfg(c); setVal((c.markup_cents / 100).toFixed(2)); });
  }, []);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const cents = Math.max(0, Math.round(parseFloat(val || '0') * 100));
      const r = await api<{ markup_cents: number }>('/api/brand/store/shipping', { method: 'PATCH', body: { markup_cents: cents } });
      setVal((r.markup_cents / 100).toFixed(2));
      setMsg('Saved.');
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  if (!cfg) return null;
  return (
    <div className="surface mt-4 max-w-xl space-y-3 p-6">
      <div className="text-[15px] font-semibold">Shipping markup</div>
      <p className="text-[12.5px] text-muted">Optional profit added to the shipping price your customers see at checkout, on top of the live carrier rate. Your wallet is only charged the carrier rate plus our pick &amp; pack — the markup is yours.</p>
      <div className="flex items-center gap-2">
        <span className="text-muted">$</span>
        <input className="app-input w-28" value={val} inputMode="decimal" onChange={(e) => setVal(e.target.value)} />
        <button className="btn" disabled={busy} onClick={save}>{busy ? '…' : 'Save'}</button>
        {msg && <span className="text-[12px] text-muted">{msg}</span>}
      </div>
    </div>
  );
}


function Upsell() {
  return (
    <div className="surface flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="text-[15px] font-semibold">Store connections are a Pro feature</div>
      <div className="max-w-md text-[13px] text-muted">Upgrade to Pro or Volume to connect your WooCommerce store and pull orders in automatically.</div>
      <Link to="/app/account" className="btn mt-2">View plans</Link>
    </div>
  );
}

function ConnectForm({ onConnected }: { onConnected: (m: ManualSetup | null) => void }) {
  const [f, setF] = useState({ store_url: '', consumer_key: '', consumer_secret: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect() {
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ manual_setup: ManualSetup | null }>('/api/brand/store/connect', { method: 'POST', body: f });
      onConnected(r.manual_setup);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not connect the store');
      setBusy(false);
    }
  }

  const valid = /^https?:\/\//.test(f.store_url) && f.consumer_key.length > 8 && f.consumer_secret.length > 8;

  return (
    <div className="surface max-w-xl space-y-4 p-6">
      <div>
        <div className="text-[15px] font-semibold">Connect WooCommerce</div>
        <p className="mt-1 text-[12.5px] text-muted">
          In WooCommerce go to <span className="text-text">WooCommerce → Settings → Advanced → REST API → Add key</span>, set permissions to <span className="text-text">Read/Write</span>, and paste the keys here.
        </p>
      </div>
      {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
      <div className="space-y-2">
        <label className="label">Store URL</label>
        <input className="app-input" placeholder="https://yourbrand.com" value={f.store_url} onChange={(e) => setF({ ...f, store_url: e.target.value })} />
        <label className="label">Consumer key (ck_…)</label>
        <input className="app-input font-mono text-[12px]" placeholder="ck_xxxxxxxx" value={f.consumer_key} onChange={(e) => setF({ ...f, consumer_key: e.target.value })} />
        <label className="label">Consumer secret (cs_…)</label>
        <input className="app-input font-mono text-[12px]" type="password" placeholder="cs_xxxxxxxx" value={f.consumer_secret} onChange={(e) => setF({ ...f, consumer_secret: e.target.value })} />
      </div>
      <button className="btn w-full" disabled={!valid || busy} onClick={connect}>{busy ? 'Verifying…' : 'Connect store'}</button>
      <p className="text-center text-[11px] text-faint">We verify the keys against your store and store them encrypted.</p>
    </div>
  );
}

function Connected({ conn, onChanged }: { conn: Connection; onChanged: () => void }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function test() {
    setBusy('test'); setMsg('');
    try { await api('/api/brand/store/test', { method: 'POST' }); setMsg('Store keys are working.'); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : 'Test failed'); }
    finally { setBusy(''); onChanged(); }
  }
  async function disconnect() {
    if (!confirm('Disconnect this store? Orders will stop importing.')) return;
    setBusy('disconnect');
    try { await api('/api/brand/store/disconnect', { method: 'POST' }); onChanged(); }
    finally { setBusy(''); }
  }

  return (
    <div className="surface max-w-xl space-y-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[15px] font-semibold">{conn.store_url}</div>
          <div className="mt-1 text-[12px] text-muted">WooCommerce · connected {new Date(conn.connected_at).toLocaleDateString()}</div>
        </div>
        <span className={`pill ${STATUS_PILL[conn.status] ?? ''}`}>{conn.status}</span>
      </div>

      {conn.last_error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{conn.last_error}</div>}
      {msg && <div className="rounded-lg border border-line2 bg-card2 px-3 py-2 text-[12px] text-muted">{msg}</div>}

      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <div className="rounded-lg border border-lline px-3 py-2 dark:border-line">
          <div className="text-[11px] uppercase tracking-wide text-faint">Order webhooks</div>
          <div className="mt-0.5">{conn.auto_webhooks ? 'Registered automatically' : 'Manual setup required'}</div>
        </div>
        <div className="rounded-lg border border-lline px-3 py-2 dark:border-line">
          <div className="text-[11px] uppercase tracking-wide text-faint">Last order</div>
          <div className="mt-0.5">{conn.last_order_at ? new Date(conn.last_order_at).toLocaleString() : '—'}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-ghost" disabled={!!busy} onClick={test}>{busy === 'test' ? '…' : 'Test connection'}</button>
        <button className="btn-ghost text-danger" disabled={!!busy} onClick={disconnect}>{busy === 'disconnect' ? '…' : 'Disconnect'}</button>
      </div>
    </div>
  );
}

function ManualSetupCard({ setup, onDismiss }: { setup: ManualSetup; onDismiss: () => void }) {
  return (
    <div className="surface mt-4 max-w-xl space-y-3 border-amber/40 p-6">
      <div className="text-[14px] font-semibold text-amber">Finish setup: add the webhook in WooCommerce</div>
      <p className="text-[12.5px] text-muted">
        We couldn't auto-register the webhook (no public URL configured yet). In <span className="text-text">WooCommerce → Settings → Advanced → Webhooks</span>, add one webhook per topic below with this delivery URL + secret.
      </p>
      <div className="space-y-2 text-[12px]">
        <Row label="Delivery URL" value={setup.webhook_url ?? '(set PUBLIC_API_BASE_URL, then reconnect)'} />
        <Row label="Secret" value={setup.webhook_secret} />
        <Row label="Topics" value={setup.topics.join(', ')} />
      </div>
      <button className="btn-ghost" onClick={onDismiss}>Done</button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <code className="mt-0.5 block break-all rounded bg-card2 px-2 py-1 font-mono text-[11.5px]">{value}</code>
    </div>
  );
}
