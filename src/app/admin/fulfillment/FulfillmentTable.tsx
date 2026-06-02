'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

export type FulfillOrder = {
  id: string;
  brand_name: string;
  customer_name: string;
  ship: string;
  fulfillment_cost: number;
  created_at: string;
  items: { product_name: string; sku: string | null; quantity: number }[];
};

type LabelResult = { order_id: string; tracking_number?: string; error?: string };

export function FulfillmentTable({ orders }: { orders: FulfillOrder[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, LabelResult>>({});
  const [error, setError] = useState<string | null>(null);

  // Live-refresh the list as orders enter/leave `processing`. router.refresh()
  // re-runs the server component so brand + line-item joins stay correct.
  const live = useRealtimeRefresh({ table: 'orders', onChange: () => router.refresh() });

  const allSelected = orders.length > 0 && selected.size === orders.length;
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)));
  }

  async function buyLabels(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke('shipstation-buy-label', {
      body: { order_ids: ids },
    });
    setBusy(false);
    if (error || data?.error) {
      setError(data?.error ?? error?.message ?? 'Label purchase failed');
      return;
    }
    const byId: Record<string, LabelResult> = {};
    for (const r of (data?.results ?? []) as LabelResult[]) byId[r.order_id] = r;
    setResults((prev) => ({ ...prev, ...byId }));
    // shipped orders drop off this list on refresh
    router.refresh();
    setSelected(new Set());
  }

  if (orders.length === 0) {
    return (
      <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
        Nothing to ship right now.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={() => buyLabels(selectedIds)}
          disabled={busy || selected.size === 0}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Buying labels…' : `Buy ${selected.size} label${selected.size === 1 ? '' : 's'}`}
        </button>
        <span className="text-xs text-muted-foreground">
          Each selected order gets its own USPS label and flips to shipped.
        </span>
        <span
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
          title={live ? 'Live — updates automatically' : 'Connecting…'}
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              live ? 'bg-emerald-500' : 'bg-muted-foreground/30'
            }`}
          />
          {live ? 'Live' : 'Connecting…'}
        </span>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Ship to</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Cost</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const r = results[o.id];
              return (
                <tr key={o.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      aria-label={`Select order ${o.id}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{o.brand_name}</td>
                  <td className="px-3 py-2">{o.customer_name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{o.ship || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {o.items.map((it, i) => (
                      <div key={i}>
                        {it.quantity}× {it.product_name}
                        {it.sku ? ` (${it.sku})` : ''}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 tabular-nums">${o.fulfillment_cost.toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r?.tracking_number ? (
                      <span className="text-emerald-600 dark:text-emerald-400">✓ {r.tracking_number}</span>
                    ) : r?.error ? (
                      <span className="text-red-600 dark:text-red-400">{r.error}</span>
                    ) : (
                      <span className="text-muted-foreground/70">—</span>
                    )}
                    <div className="mt-1">
                      <button
                        onClick={() => buyLabels([o.id])}
                        disabled={busy}
                        className="text-brand hover:underline disabled:opacity-50"
                      >
                        Buy label
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
