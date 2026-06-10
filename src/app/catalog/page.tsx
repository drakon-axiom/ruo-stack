import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type VariantRow = {
  sku: string;
  size: string;
  wholesale_cost: number;
  suggested_retail: number | null;
  in_stock: boolean;
};
type ProductRow = {
  id: string;
  name: string;
  category: string;
  slug: string;
  product_variants: VariantRow[];
};

export default async function CatalogPage() {
  const supabase = await createClient();
  // Catalog is readable by any authenticated user (RLS: products_read).
  const { data: products } = await supabase
    .from('products')
    .select('id, name, category, slug, product_variants(sku, size, wholesale_cost, suggested_retail, in_stock)')
    .eq('is_active', true)
    .order('category');

  const rows = (products ?? []) as ProductRow[];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-bold">Catalog</h1>
      <p className="mt-2 text-muted-foreground">
        Wholesale cost is debited from your wallet on fulfillment. Suggested retail is a
        starting point — you set your own prices.
      </p>

      <div className="mt-8 space-y-8">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No products yet (sign in to view the catalog, or seed the database).
          </p>
        )}
        {rows.map((p) => (
          <div key={p.id} className="rounded-lg border">
            <div className="border-b bg-muted/50 px-4 py-3">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{p.category}</span>
              <h2 className="text-lg font-semibold">{p.name}</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Size</th>
                  <th className="px-4 py-2">SKU</th>
                  <th className="px-4 py-2">Cost</th>
                  <th className="px-4 py-2">Suggested retail</th>
                  <th className="px-4 py-2">Stock</th>
                </tr>
              </thead>
              <tbody>
                {p.product_variants.map((v) => (
                  <tr key={v.sku} className="border-t">
                    <td className="px-4 py-2">{v.size}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.sku}</td>
                    <td className="px-4 py-2">${v.wholesale_cost.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      {v.suggested_retail ? `$${v.suggested_retail.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2">{v.in_stock ? '✅' : '❌'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </main>
  );
}
