import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface Product {
  id: string;
  canonicalSku: string;
  name: string;
  compound: string;
  dose?: string | null;
  unit?: string | null;
  wholesaleCost: number | null;
  suggestedRetail: number;
  status: string;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const margin = (cost: number | null, retail: number) =>
  cost != null && retail > 0 ? `${Math.round(((retail - cost) / retail) * 100)}%` : '—';

// Read-only projection of published CatalogProducts — the brand price sheet.
// Wholesale pricing is gated behind active Pro membership.
export function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [pro, setPro] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ pro: boolean; products: Product[] }>('/api/brand/catalog').then((r) => {
      setProducts(r.products);
      setPro(r.pro);
      setLoading(false);
    });
  }, []);

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">Research Peptides</h1>
      <p className="mb-4 text-[13px] text-muted">Wholesale price sheet. Set your own retail and keep the spread. Research use only.</p>

      {!pro && !loading && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-amber/40 bg-amber/10 px-4 py-3">
          <span className="text-[13px] text-amber">Subscribe to <strong>Pro</strong> to unlock wholesale pricing and fulfillment.</span>
          <a href="/app/account" className="btn">Subscribe to Pro</a>
        </div>
      )}

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
                <th className="px-4 py-3">Suggested retail</th>
                <th className="px-4 py-3">Margin</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-lline/60 dark:border-line/60">
                  <td className="px-4 py-3 font-medium">{p.name}{p.dose ? ` · ${p.dose}${p.unit ?? ''}` : ''}</td>
                  <td className="px-4 py-3">{p.wholesaleCost != null ? dollars(p.wholesaleCost) : <span className="text-faint">🔒 Pro</span>}</td>
                  <td className="px-4 py-3 text-success">{dollars(p.suggestedRetail)}</td>
                  <td className="px-4 py-3">{margin(p.wholesaleCost, p.suggestedRetail)}</td>
                  <td className="px-4 py-3"><span className="pill">{p.status.replace(/_/g, ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
