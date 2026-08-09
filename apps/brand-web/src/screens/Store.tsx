import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { ManagedProducts, ProvisioningWizard } from '../components/ProvisioningWizard.js';
import { Button, Input, buttonClass, cardClass, labelClass, pillClass } from '@ruostack/ui';

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
  disabled: 'border-line-strong bg-surface-3 text-content-muted',
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
      <h1 className="mb-1 text-2xl font-bold">My Store</h1>
      <p className="mb-5 text-sm text-content-muted">Connect your WooCommerce store. Orders flow into RUOStack automatically; tracking is written back when we ship.</p>

      {loading || !state ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>
      ) : !state.plan_allows ? (
        <Upsell />
      ) : state.connection ? (
        <>
          <Connected conn={state.connection} onChanged={() => { setManual(null); load(); }} />
          {isOwner && <ShippingMarkup />}
          {isOwner ? (
            <ProvisioningWizard />
          ) : (
            <div className={cardClass('mt-4 p-6 text-sm text-content-muted')}>
              Only an owner can add products to your store or change shipping rates. You can still see what’s already
              synced below.
            </div>
          )}
          <ManagedProducts />
        </>
      ) : isOwner ? (
        <ConnectForm onConnected={(m) => { setManual(m); load(); }} />
      ) : (
        <div className={cardClass('p-10 text-center text-content-muted')}>
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
    <div className={cardClass('mt-4 max-w-xl space-y-3 p-6')}>
      <div className="text-lg font-semibold">Shipping markup</div>
      <p className="text-xs text-content-muted">Optional profit added to the shipping price your customers see at checkout, on top of the live carrier rate. Your wallet is only charged the carrier rate plus our pick &amp; pack — the markup is yours.</p>
      <div className="flex items-center gap-2">
        <span className="text-content-muted">$</span>
        <Input className="w-28" value={val} inputMode="decimal" onChange={(e) => setVal(e.target.value)} />
        <Button loading={busy} onClick={save}>Save</Button>
        {msg && <span className="text-xs text-content-muted">{msg}</span>}
      </div>
    </div>
  );
}


function Upsell() {
  return (
    <div className={cardClass('flex flex-col items-center gap-2 px-6 py-14 text-center')}>
      <div className="text-lg font-semibold">Store connections are a Pro feature</div>
      <div className="max-w-md text-sm text-content-muted">Upgrade to Pro or Volume to connect your WooCommerce store and pull orders in automatically.</div>
      <Link to="/app/account" className={buttonClass('primary', 'md', 'mt-2')}>View plans</Link>
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
    <div className={cardClass('max-w-xl space-y-4 p-6')}>
      <div>
        <div className="text-lg font-semibold">Connect WooCommerce</div>
        <p className="mt-1 text-xs text-content-muted">
          In WooCommerce go to <span className="text-content">WooCommerce → Settings → Advanced → REST API → Add key</span>, set permissions to <span className="text-content">Read/Write</span>, and paste the keys here.
        </p>
      </div>
      {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <div className="space-y-2">
        <label className={labelClass()}>Store URL</label>
        <Input placeholder="https://yourbrand.com" value={f.store_url} onChange={(e) => setF({ ...f, store_url: e.target.value })} />
        <label className={labelClass()}>Consumer key (ck_…)</label>
        <Input className="font-mono text-xs" placeholder="ck_xxxxxxxx" value={f.consumer_key} onChange={(e) => setF({ ...f, consumer_key: e.target.value })} />
        <label className={labelClass()}>Consumer secret (cs_…)</label>
        <Input className="font-mono text-xs" type="password" placeholder="cs_xxxxxxxx" value={f.consumer_secret} onChange={(e) => setF({ ...f, consumer_secret: e.target.value })} />
      </div>
      <Button className="w-full" disabled={!valid || busy} onClick={connect}>{busy ? 'Verifying…' : 'Connect store'}</Button>
      <p className="text-center text-2xs text-content-faint">We verify the keys against your store and store them encrypted.</p>
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
    <div className={cardClass('max-w-xl space-y-4 p-6')}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{conn.store_url}</div>
          <div className="mt-1 text-xs text-content-muted">WooCommerce · connected {new Date(conn.connected_at).toLocaleDateString()}</div>
        </div>
        <span className={pillClass(`${STATUS_PILL[conn.status] ?? ''}`)}>{conn.status}</span>
      </div>

      {conn.last_error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{conn.last_error}</div>}
      {msg && <div className="rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-xs text-content-muted">{msg}</div>}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-line px-3 py-2 dark:border-line">
          <div className="text-2xs uppercase tracking-wide text-content-faint">Order webhooks</div>
          <div className="mt-0.5">{conn.auto_webhooks ? 'Registered automatically' : 'Manual setup required'}</div>
        </div>
        <div className="rounded-lg border border-line px-3 py-2 dark:border-line">
          <div className="text-2xs uppercase tracking-wide text-content-faint">Last order</div>
          <div className="mt-0.5">{conn.last_order_at ? new Date(conn.last_order_at).toLocaleString() : '—'}</div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" disabled={!!busy} onClick={test}>{busy === 'test' ? '…' : 'Test connection'}</Button>
        <Button variant="ghost" className="text-danger" disabled={!!busy} onClick={disconnect}>{busy === 'disconnect' ? '…' : 'Disconnect'}</Button>
      </div>
    </div>
  );
}

function ManualSetupCard({ setup, onDismiss }: { setup: ManualSetup; onDismiss: () => void }) {
  return (
    <div className={cardClass('mt-4 max-w-xl space-y-3 border-warning/40 p-6')}>
      <div className="text-base font-semibold text-warning">Finish setup: add the webhook in WooCommerce</div>
      <p className="text-xs text-content-muted">
        We couldn't auto-register the webhook (no public URL configured yet). In <span className="text-content">WooCommerce → Settings → Advanced → Webhooks</span>, add one webhook per topic below with this delivery URL + secret.
      </p>
      <div className="space-y-2 text-xs">
        <Row label="Delivery URL" value={setup.webhook_url ?? '(set PUBLIC_API_BASE_URL, then reconnect)'} />
        <Row label="Secret" value={setup.webhook_secret} />
        <Row label="Topics" value={setup.topics.join(', ')} />
      </div>
      <Button variant="ghost" onClick={onDismiss}>Done</Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-content-faint">{label}</div>
      <code className="mt-0.5 block break-all rounded bg-surface-3 px-2 py-1 font-mono text-xs">{value}</code>
    </div>
  );
}
