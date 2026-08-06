import { useEffect, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { EmptyState, PageHeader, Tabs } from '../components/ui.js';

interface NoMatchOrder {
  id: string;
  brand_id: string;
  brand_name: string;
  external_order_id: string | null;
  recipient: { name: string; city: string; state: string };
  unmatched_skus: string[];
  created_at: string;
}
interface Alias {
  id: string;
  brand_name: string;
  woo_sku: string;
  canonical_sku: string;
  product_name: string;
  created_at: string;
}
interface CatalogProduct { id: string; name: string; canonicalSku: string }

type Tab = 'no_match' | 'aliases';

export function StoreMatch() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'exceptions') : false;
  const [tab, setTab] = useState<Tab>('no_match');
  const [orders, setOrders] = useState<NoMatchOrder[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({}); // `${orderId}:${sku}` → productId
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  function load() {
    api<{ orders: NoMatchOrder[] }>('/api/admin/no-match').then((r) => setOrders(r.orders));
    api<{ aliases: Alias[] }>('/api/admin/aliases').then((r) => setAliases(r.aliases));
  }
  useEffect(() => {
    load();
    api<{ products: CatalogProduct[] }>('/api/admin/catalog').then((r) => setCatalog(r.products));
  }, []);

  async function mapSku(order: NoMatchOrder, sku: string) {
    const key = `${order.id}:${sku}`;
    // Require an EXPLICIT product choice. Never fall back to catalog[0]: mapping
    // creates an alias that immediately auto-releases the blocked order for
    // fulfillment, so a default pick would ship the wrong physical product.
    const productId = pick[key];
    if (!productId) return;
    setErr(''); setBusy(key);
    try {
      await api('/api/admin/aliases', { method: 'POST', body: { brand_id: order.brand_id, woo_sku: sku, product_id: productId } });
      load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Map failed'); }
    finally { setBusy(''); }
  }
  async function delAlias(a: Alias) {
    if (!confirm(`Remove alias ${a.woo_sku} → ${a.canonical_sku}?`)) return;
    await api(`/api/admin/aliases/${a.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <PageHeader title="Store Match" subtitle="Resolve No-Match store items by mapping a store SKU to a catalog product. Mapping auto-releases blocked orders." />

      <div className="mb-3">
        <Tabs<Tab> active={tab} onChange={setTab} tabs={[{ key: 'no_match', label: 'No-Match', count: orders.length }, { key: 'aliases', label: 'Aliases', count: aliases.length }]} />
      </div>
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}

      {tab === 'no_match' ? (
        orders.length === 0 ? <EmptyState title="All clear" hint="No unmatched store orders." /> : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="card p-4">
                <div className="mb-2 flex items-center justify-between text-[13px]">
                  <div><span className="text-text">{o.brand_name}</span> · {o.recipient.name} · {o.recipient.city}, {o.recipient.state}</div>
                  <div className="font-mono text-[11px] text-faint">{o.external_order_id}</div>
                </div>
                <div className="space-y-2">
                  {o.unmatched_skus.map((sku) => {
                    const key = `${o.id}:${sku}`;
                    return (
                      <div key={sku} className="flex items-center gap-2 text-[13px]">
                        <span className="rounded-pill border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[11px] text-amber">{sku}</span>
                        <span className="text-faint">→</span>
                        <select className="input flex-1" value={pick[key] ?? ''} onChange={(e) => setPick({ ...pick, [key]: e.target.value })}>
                          <option value="">Select a catalog product…</option>
                          {catalog.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.canonicalSku})</option>)}
                        </select>
                        {writable && <button className="btn" disabled={busy === key || !pick[key]} onClick={() => mapSku(o, sku)}>{busy === key ? '…' : 'Map'}</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : aliases.length === 0 ? <EmptyState title="No aliases" hint="Aliases you create here will appear in this list." /> : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <th className="px-4 py-3">Brand</th><th className="px-4 py-3">Store SKU</th><th className="px-4 py-3">→ Canonical</th><th className="px-4 py-3">Product</th><th className="px-4 py-3 text-right"></th>
            </tr></thead>
            <tbody>
              {aliases.map((a) => (
                <tr key={a.id} className="border-b border-line/60">
                  <td className="px-4 py-3 text-text">{a.brand_name}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted">{a.woo_sku}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{a.canonical_sku}</td>
                  <td className="px-4 py-3 text-muted">{a.product_name}</td>
                  <td className="px-4 py-3 text-right">{writable && <button className="btn-ghost text-[12px] text-danger" onClick={() => delAlias(a)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
