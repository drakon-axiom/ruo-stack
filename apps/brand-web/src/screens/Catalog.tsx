import { useEffect, useState } from 'react';
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
const margin = (cost: number, retail: number) => (retail > 0 ? `${Math.round(((retail - cost) / retail) * 100)}%` : '—');
const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', volume: 'Volume' };

// Brand price sheet. Wholesale is the brand's tier rate; retail is the brand's
// own price (editable here), defaulting to the operator's suggestion.
export function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [plan, setPlan] = useState('starter');
  const [loading, setLoading] = useState(true);

  function load() {
    api<{ plan: string; products: Product[] }>('/api/brand/catalog').then((r) => {
      setProducts(r.products);
      setPlan(r.plan);
      setLoading(false);
    });
  }
  useEffect(load, []);

  async function saveRetail(id: string, dollarsStr: string) {
    const cents = Math.round(parseFloat(dollarsStr || '0') * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    await api(`/api/brand/catalog/${id}/retail`, { method: 'PATCH', body: { retail_cents: cents } });
    load();
  }

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">Research Peptides</h1>
      <p className="mb-5 text-[13px] text-muted">
        Wholesale shown at your <span className="text-teal">{PLAN_LABEL[plan]}</span> rate. Set your own retail and keep the spread. Research use only.
      </p>

      {loading ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : products.length === 0 ? (
        <div className="surface p-10 text-center text-muted">No published products yet.</div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Your cost</th>
                <th className="px-4 py-3">Your retail</th>
                <th className="px-4 py-3">Margin</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <RetailRow key={p.id} product={p} onSave={saveRetail} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-faint">Tip: edit a retail price and press Enter or click away to save. Defaults to the suggested retail.</p>
    </>
  );
}

function RetailRow({ product: p, onSave }: { product: Product; onSave: (id: string, v: string) => void }) {
  const [val, setVal] = useState((p.retail_cents / 100).toFixed(2));
  const [saving, setSaving] = useState(false);

  async function commit() {
    const target = (p.retail_cents / 100).toFixed(2);
    if (val === target) return; // unchanged
    setSaving(true);
    await onSave(p.id, val);
    setSaving(false);
  }

  return (
    <tr className="border-b border-lline/60 dark:border-line/60">
      <td className="px-4 py-3 font-medium">{p.name}{p.dose ? ` · ${p.dose}${p.unit ?? ''}` : ''}</td>
      <td className="px-4 py-3">{dollars(p.wholesale_cents)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="text-faint">$</span>
          <input
            className="w-20 rounded-md border border-lline bg-transparent px-2 py-1 text-[13px] text-success outline-none focus:border-teal dark:border-line"
            inputMode="decimal"
            value={val}
            disabled={saving}
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {!p.retail_is_custom && <span className="text-[10px] text-faint">suggested</span>}
        </div>
      </td>
      <td className="px-4 py-3">{margin(p.wholesale_cents, Math.round(parseFloat(val || '0') * 100))}</td>
      <td className="px-4 py-3"><span className="pill">{p.status.replace(/_/g, ' ')}</span></td>
    </tr>
  );
}
