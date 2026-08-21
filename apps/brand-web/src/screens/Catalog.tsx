import { useEffect, useState } from 'react';
import { DataTable, EmptyState, PageHeader, StatusPill, type Column } from '@ruostack/ui';
import { PLAN_KEYS, planLabel, type PlanKey } from '@ruostack/shared';
import { api } from '../lib/api.js';

interface Product {
  id: string;
  name: string;
  dose?: string | null;
  unit?: string | null;
  status: string;
  wholesale_cents: number;
  suggested_retail_cents: number;
  retail_cents: number;
  retail_is_custom: boolean;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const margin = (cost: number, retail: number) =>
  retail > 0 ? `${Math.round(((retail - cost) / retail) * 100)}%` : '—';
const planDisplay = (key: string) => (PLAN_KEYS.includes(key as PlanKey) ? planLabel(key as PlanKey) : key);

const productLabel = (p: Product) => `${p.name}${p.dose ? ` · ${p.dose}${p.unit ?? ''}` : ''}`;

// Brand price sheet. Wholesale is the brand's tier rate; retail is the brand's
// own price (editable here), defaulting to the operator's suggestion.
export function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [plan, setPlan] = useState('starter');
  const [loading, setLoading] = useState(true);
  // Retail edits live here rather than inside a row component so the margin
  // column can recompute from the in-progress value, as it did before.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    api<{ plan: string; products: Product[] }>('/api/brand/catalog').then((r) => {
      setProducts(r.products);
      setPlan(r.plan);
      setDraft(Object.fromEntries(r.products.map((p) => [p.id, (p.retail_cents / 100).toFixed(2)])));
      setLoading(false);
    });
  }
  useEffect(load, []);

  async function commit(p: Product) {
    const val = draft[p.id] ?? '';
    if (val === (p.retail_cents / 100).toFixed(2)) return; // unchanged
    const cents = Math.round(parseFloat(val || '0') * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    setSaving(p.id);
    await api(`/api/brand/catalog/${p.id}/retail`, { method: 'PATCH', body: { retail_cents: cents } });
    setSaving(null);
    load();
  }

  const columns: Column<Product>[] = [
    { key: 'name', header: 'Product', priority: 'primary', cell: productLabel },
    {
      key: 'cost',
      header: 'Your cost',
      align: 'right',
      mono: true,
      cell: (p) => dollars(p.wholesale_cents),
    },
    {
      key: 'retail',
      header: 'Your retail',
      cell: (p) => (
        <div className="flex items-center justify-end gap-1 md:justify-start">
          <span className="text-content-faint">$</span>
          <input
            aria-label={`Retail price for ${productLabel(p)}`}
            className="w-20 rounded-md border border-line bg-transparent px-2 py-1 text-sm font-mono tabular-nums text-success transition-colors duration-fast focus:border-accent"
            inputMode="decimal"
            value={draft[p.id] ?? ''}
            disabled={saving === p.id}
            onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })}
            onBlur={() => commit(p)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {!p.retail_is_custom && <span className="text-2xs text-content-faint">suggested</span>}
        </div>
      ),
    },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      mono: true,
      cell: (p) => margin(p.wholesale_cents, Math.round(parseFloat(draft[p.id] || '0') * 100)),
    },
    { key: 'status', header: 'Status', cell: (p) => <StatusPill value={p.status} /> },
  ];

  return (
    <>
      <PageHeader title="Research Peptides" />
      <p className="-mt-3 mb-5 text-sm text-content-muted">
        Wholesale shown at your <span className="text-accent">{planDisplay(plan)}</span> rate. Set your
        own retail and keep the spread. Research use only.
      </p>

      <DataTable
        caption="Your product price sheet"
        columns={columns}
        rows={products}
        rowKey={(p) => p.id}
        loading={loading}
        empty={
          <EmptyState
            title="No published products yet"
            hint="Products appear here once the operator publishes them."
          />
        }
      />

      <p className="mt-3 text-2xs text-content-faint">
        Tip: edit a retail price and press Enter or click away to save. Defaults to the suggested retail.
      </p>
    </>
  );
}
