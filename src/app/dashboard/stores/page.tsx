'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Conn = {
  id: string;
  store_url: string;
  is_active: boolean;
  last_synced_at: string | null;
};
type SyncLog = {
  kind: string;
  status: string;
  items_synced: number | null;
  error_message: string | null;
  finished_at: string;
};

export default function StoresPage() {
  const supabase = createClient();
  const router = useRouter();
  const [conn, setConn] = useState<Conn | null>(null);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  // connect form
  const [storeUrl, setStoreUrl] = useState('');
  const [ckey, setCkey] = useState('');
  const [csecret, setCsecret] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login?next=/dashboard/stores');
      return;
    }
    // NOTE: never select credentials_encrypted client-side.
    const { data: c } = await supabase
      .from('store_connections')
      .select('id, store_url, is_active, last_synced_at')
      .eq('platform', 'woocommerce')
      .eq('is_active', true)
      .maybeSingle();
    setConn(c as Conn | null);
    const { data: l } = await supabase
      .from('sync_logs')
      .select('kind, status, items_synced, error_message, finished_at')
      .order('finished_at', { ascending: false })
      .limit(8);
    setLogs((l as SyncLog[]) ?? []);
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function call(action: string, payload?: unknown, label?: string) {
    setBusy(action);
    setMsg(null);
    setError(null);
    const { data, error } = await supabase.functions.invoke('woo-sync', {
      body: { action, payload },
    });
    setBusy(null);
    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? 'Request failed');
      return;
    }
    setMsg(label ?? summarize(action, data));
    await load();
  }

  if (loading) return <main className="mx-auto max-w-2xl px-6 py-16 text-muted-foreground">Loading…</main>;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold">Store connection</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect WooCommerce to auto-import orders and push tracking back.
      </p>

      {msg && <p className="mt-4 rounded bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{msg}</p>}
      {error && <p className="mt-4 rounded bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      {!conn ? (
        <section className="mt-6 space-y-4 rounded-lg border p-5">
          <h2 className="font-semibold">Connect WooCommerce</h2>
          <p className="text-xs text-muted-foreground">
            In WooCommerce: <strong>WooCommerce → Settings → Advanced → REST API → Add key</strong>{' '}
            (Read/Write). Paste the consumer key & secret here. They’re encrypted before storage.
          </p>
          <Input label="Store URL" value={storeUrl} onChange={setStoreUrl} placeholder="https://yourstore.com" />
          <Input label="Consumer key" value={ckey} onChange={setCkey} placeholder="ck_…" />
          <Input label="Consumer secret" value={csecret} onChange={setCsecret} placeholder="cs_…" type="password" />
          <button
            disabled={busy !== null || !storeUrl || !ckey || !csecret}
            onClick={() =>
              call('connect', { store_url: storeUrl, consumer_key: ckey, consumer_secret: csecret }, 'Store connected.')
            }
            className="rounded bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'connect' ? 'Connecting…' : 'Connect store'}
          </button>
        </section>
      ) : (
        <section className="mt-6 space-y-4 rounded-lg border p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{conn.store_url}</p>
              <p className="text-xs text-muted-foreground">
                Last synced:{' '}
                {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : 'never'}
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">Connected</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Action busy={busy} action="test_connection" onClick={() => call('test_connection', undefined, 'Connection OK.')}>
              Test
            </Action>
            <Action busy={busy} action="sync_orders" onClick={() => call('sync_orders')}>
              Sync orders
            </Action>
            <Action busy={busy} action="sync_products" onClick={() => call('sync_products')}>
              Sync products
            </Action>
            <Action busy={busy} action="push_tracking" onClick={() => call('push_tracking')}>
              Push tracking
            </Action>
            <button
              disabled={busy !== null}
              onClick={() => call('disconnect', undefined, 'Disconnected.')}
              className="rounded border border-red-300 dark:border-red-900 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">Recent sync activity</h2>
        <div className="mt-2 overflow-hidden rounded-lg border text-sm">
          {logs.length === 0 && <p className="px-4 py-6 text-center text-muted-foreground">No sync activity yet.</p>}
          {logs.map((l, i) => (
            <div key={i} className="flex items-center justify-between border-b px-4 py-2 last:border-0">
              <span className="font-mono text-xs">{l.kind}</span>
              <span className={l.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                {l.status === 'ok' ? `${l.items_synced ?? 0} synced` : l.error_message ?? 'error'}
              </span>
              <span className="text-xs text-muted-foreground/70">{new Date(l.finished_at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function summarize(action: string, data: any): string {
  if (action === 'sync_orders') return `Imported ${data?.imported ?? 0} order(s).`;
  if (action === 'sync_products') return `Synced ${data?.items_synced ?? 0} product(s).`;
  if (action === 'push_tracking') return `Pushed tracking for ${data?.pushed ?? 0} order(s).`;
  return 'Done.';
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border px-3 py-2 text-sm"
      />
    </label>
  );
}

function Action({
  busy,
  action,
  onClick,
  children,
}: {
  busy: string | null;
  action: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={busy !== null}
      onClick={onClick}
      className="rounded border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
    >
      {busy === action ? '…' : children}
    </button>
  );
}
