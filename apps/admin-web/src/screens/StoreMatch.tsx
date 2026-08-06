import { useEffect, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import {
  Button,
  DataTable,
  EmptyState,
  InlineAlert,
  PageHeader,
  Select,
  Tabs,
  cardClass,
  type Column,
} from '@ruostack/ui';

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

  // scroll mode: an alias only reads correctly as store SKU -> canonical SKU,
  // side by side.
  const aliasColumns: Column<Alias>[] = [
    { key: 'brand', header: 'Brand', priority: 'primary', minWidth: 140, cell: (a) => a.brand_name },
    { key: 'woo', header: 'Store SKU', mono: true, minWidth: 150, cell: (a) => a.woo_sku },
    { key: 'canonical', header: '\u2192 Canonical', mono: true, minWidth: 150, cell: (a) => a.canonical_sku },
    { key: 'product', header: 'Product', minWidth: 180, cell: (a) => a.product_name },
    {
      key: 'actions',
      header: '',
      align: 'right',
      minWidth: 100,
      cell: (a) =>
        writable ? (
          <Button variant="danger" size="sm" onClick={() => delAlias(a)}>
            Remove
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Store Match" subtitle="Resolve No-Match store items by mapping a store SKU to a catalog product. Mapping auto-releases blocked orders." />

      <div className="mb-3">
        <Tabs<Tab> active={tab} onChange={setTab} tabs={[{ key: 'no_match', label: 'No-Match', count: orders.length }, { key: 'aliases', label: 'Aliases', count: aliases.length }]} />
      </div>
      {err && (
        <div className="mb-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}

      {tab === 'no_match' ? (
        orders.length === 0 ? <EmptyState title="All clear" hint="No unmatched store orders." /> : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id} className={cardClass('p-4')}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <div><span className="text-content">{o.brand_name}</span> · {o.recipient.name} · {o.recipient.city}, {o.recipient.state}</div>
                  <div className="font-mono text-2xs text-content-faint">{o.external_order_id}</div>
                </div>
                <div className="space-y-2">
                  {o.unmatched_skus.map((sku) => {
                    const key = `${o.id}:${sku}`;
                    return (
                      <div key={sku} className="flex items-center gap-2 text-sm">
                        <span className="rounded-pill border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-2xs text-warning">{sku}</span>
                        <span className="text-content-faint">→</span>
                        <Select
                          className="flex-1"
                          placeholder="Select a catalog product…"
                          value={pick[key] ?? ''}
                          onValueChange={(v) => setPick({ ...pick, [key]: v })}
                          options={catalog.map((p) => ({
                            value: p.id,
                            label: `${p.name} (${p.canonicalSku})`,
                          }))}
                        />
                        {writable && (
                          <Button
                            disabled={!pick[key]}
                            loading={busy === key}
                            onClick={() => mapSku(o, sku)}
                          >
                            Map
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        <DataTable
          caption="SKU aliases mapping store SKUs to catalog products"
          mode="scroll"
          columns={aliasColumns}
          rows={aliases}
          rowKey={(a) => a.id}
          empty={
            <EmptyState title="No aliases" hint="Aliases you create here will appear in this list." />
          }
        />
      )}
    </>
  );
}
