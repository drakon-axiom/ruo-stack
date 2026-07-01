import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface Product {
  id: string;
  name: string;
  dose?: string | null;
  unit?: string | null;
  coaId?: string | null;
}

function CopyLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return <button className="btn-ghost text-[12px]" onClick={copy}>{copied ? '✓ Copied' : 'Copy link'}</button>;
}

// Certificates of Analysis — third-party batch testing, set by the operator per
// product (CatalogProduct.coaId). Brands can view + share these with customers.
export function Coas() {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    api<{ products: Product[] }>('/api/brand/catalog').then((r) => setProducts(r.products));
  }, []);

  const withCoa = (products ?? []).filter((p) => p.coaId);

  return (
    <>
      <h1 className="mb-1 text-[23px] font-bold">Certificates of Analysis</h1>
      <p className="mb-5 text-[13px] text-muted">
        Every product is independently third-party verified. Share these COAs with your customers for transparency.
      </p>

      {!products ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : withCoa.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 px-6 py-16 text-center">
          <div className="text-[15px] font-semibold">No COAs available yet</div>
          <div className="max-w-md text-[13px] text-muted">
            Certificates appear here as products are batch-tested. Check back soon.
          </div>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {withCoa.map((p) => (
                <tr key={p.id} className="border-b border-lline/60 dark:border-line/60">
                  <td className="px-4 py-3 font-medium">{p.name}{p.dose ? ` · ${p.dose}${p.unit ?? ''}` : ''}</td>
                  <td className="px-4 py-3"><span className="pill border-success/40 bg-success/10 text-success">✓ Third-party verified</span></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a className="btn-ghost text-[12px]" href={p.coaId!} target="_blank" rel="noreferrer">View</a>
                      <CopyLink value={p.coaId!} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
