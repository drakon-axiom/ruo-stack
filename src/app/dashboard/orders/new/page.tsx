'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Variant = {
  id: string;
  sku: string;
  size: string;
  wholesale_cost: number;
  in_stock: boolean;
  product_name: string;
};
type Line = { variant_id: string; quantity: number };
type SavedCustomer = {
  id: string;
  name: string;
  email: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export default function NewOrderPage() {
  const supabase = createClient();
  const router = useRouter();

  const [variants, setVariants] = useState<Variant[]>([]);
  const [saved, setSaved] = useState<SavedCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [shippingCost, setShippingCost] = useState('0');
  const [saveCustomer, setSaveCustomer] = useState(false);

  const [lines, setLines] = useState<Line[]>([{ variant_id: '', quantity: 1 }]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ order_id: string; status: string } | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login?next=/dashboard/orders/new');
        return;
      }
      const [{ data: products }, { data: customers }] = await Promise.all([
        supabase
          .from('product_variants')
          .select('id, sku, size, wholesale_cost, in_stock, products(name)')
          .eq('in_stock', true)
          .order('sku'),
        supabase
          .from('saved_customers')
          .select('id, name, email, street, city, state, zip')
          .order('last_used_at', { ascending: false })
          .limit(50),
      ]);
      setVariants(
        (products ?? []).map((v: any) => ({
          id: v.id,
          sku: v.sku,
          size: v.size,
          wholesale_cost: v.wholesale_cost,
          in_stock: v.in_stock,
          product_name: v.products?.name ?? v.sku,
        }))
      );
      setSaved((customers as SavedCustomer[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const variantById = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);

  const itemsTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const v = variantById.get(l.variant_id);
        return sum + (v ? v.wholesale_cost * l.quantity : 0);
      }, 0),
    [lines, variantById]
  );
  const grandTotal = itemsTotal + (Number(shippingCost) || 0);

  function applySavedCustomer(id: string) {
    const c = saved.find((s) => s.id === id);
    if (!c) return;
    setCustomerName(c.name);
    setCustomerEmail(c.email ?? '');
    setStreet(c.street ?? '');
    setCity(c.city ?? '');
    setState(c.state ?? '');
    setZip(c.zip ?? '');
  }

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  const addLine = () => setLines((ls) => [...ls, { variant_id: '', quantity: 1 }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  async function submit() {
    setError(null);
    if (!customerName.trim()) return setError('Customer name is required.');
    const items = lines.filter((l) => l.variant_id && l.quantity > 0);
    if (items.length === 0) return setError('Add at least one product.');

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke('create-manual-order', {
      body: {
        customer_name: customerName,
        customer_email: customerEmail || undefined,
        ship_street: street || undefined,
        ship_city: city || undefined,
        ship_state: state || undefined,
        ship_zip: zip || undefined,
        shipping_cost: Number(shippingCost) || 0,
        items,
      },
    });

    if (error || data?.error) {
      setSubmitting(false);
      setError(data?.error ?? error?.message ?? 'Failed to create order');
      return;
    }

    // optionally remember the customer for next time
    if (saveCustomer) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('saved_customers').insert({
          user_id: user.id,
          name: customerName,
          email: customerEmail || null,
          street: street || null,
          city: city || null,
          state: state || null,
          zip: zip || null,
        });
      }
    }

    setSubmitting(false);
    setResult({ order_id: data.order_id, status: data.status });
  }

  if (loading) return <main className="mx-auto max-w-2xl px-6 py-16 text-gray-500">Loading…</main>;

  if (result) {
    const parked = result.status === 'awaiting_funds';
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">{parked ? 'Order parked' : 'Order created'}</h1>
        <p className={`mt-3 rounded px-3 py-2 text-sm ${parked ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {parked
            ? '💰 Your wallet balance is too low — the order is awaiting funds. Top up and it will resume automatically.'
            : '📦 Order is processing. Buy a label when you’re ready to ship.'}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a href="/dashboard" className="rounded border px-4 py-2 text-sm">Back to dashboard</a>
          {parked && <a href="/checkout" className="rounded bg-brand px-4 py-2 text-sm text-white">Add funds</a>}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold">New manual order</h1>
      <p className="mt-1 text-sm text-gray-500">
        Cost is debited from your wallet on creation. Prices come from the catalog.
      </p>

      {/* customer */}
      <section className="mt-6 space-y-4 rounded-lg border p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Customer</h2>
          {saved.length > 0 && (
            <select
              onChange={(e) => applySavedCustomer(e.target.value)}
              defaultValue=""
              className="rounded border bg-white px-2 py-1 text-xs"
            >
              <option value="">Use saved customer…</option>
              {saved.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Name *" value={customerName} onChange={setCustomerName} />
          <Input label="Email" value={customerEmail} onChange={setCustomerEmail} />
        </div>
        <Input label="Street" value={street} onChange={setStreet} />
        <div className="grid grid-cols-3 gap-3">
          <Input label="City" value={city} onChange={setCity} />
          <Input label="State" value={state} onChange={setState} placeholder="CA" />
          <Input label="ZIP" value={zip} onChange={setZip} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} />
          Save this customer for next time
        </label>
      </section>

      {/* items */}
      <section className="mt-6 space-y-3 rounded-lg border p-5">
        <h2 className="font-semibold">Products</h2>
        {lines.map((line, i) => {
          const v = variantById.get(line.variant_id);
          return (
            <div key={i} className="flex items-center gap-2">
              <select
                value={line.variant_id}
                onChange={(e) => setLine(i, { variant_id: e.target.value })}
                className="flex-1 rounded border bg-white px-2 py-2 text-sm"
              >
                <option value="">Select product…</option>
                {variants.map((vr) => (
                  <option key={vr.id} value={vr.id}>
                    {vr.product_name} — {vr.size} (${vr.wholesale_cost.toFixed(2)})
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) => setLine(i, { quantity: Math.max(1, Number(e.target.value)) })}
                className="w-16 rounded border px-2 py-2 text-sm"
              />
              <span className="w-16 text-right text-sm tabular-nums">
                {v ? `$${(v.wholesale_cost * line.quantity).toFixed(2)}` : '—'}
              </span>
              <button
                onClick={() => removeLine(i)}
                disabled={lines.length === 1}
                className="px-2 text-gray-400 hover:text-red-600 disabled:opacity-30"
                aria-label="Remove line"
              >
                ✕
              </button>
            </div>
          );
        })}
        <button onClick={addLine} className="text-sm text-brand hover:underline">
          + Add product
        </button>
      </section>

      {/* totals */}
      <section className="mt-6 rounded-lg border p-5">
        <div className="flex items-center justify-between">
          <label className="text-sm">Shipping cost</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={shippingCost}
            onChange={(e) => setShippingCost(e.target.value)}
            className="w-28 rounded border px-2 py-1 text-right text-sm"
          />
        </div>
        <div className="mt-3 flex items-center justify-between border-t pt-3">
          <span className="text-sm text-gray-500">Items</span>
          <span className="tabular-nums">${itemsTotal.toFixed(2)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-lg font-semibold">
          <span>Wallet debit</span>
          <span className="tabular-nums">${grandTotal.toFixed(2)}</span>
        </div>
      </section>

      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <a href="/dashboard" className="rounded border px-4 py-2 text-sm">Cancel</a>
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Creating…' : `Create order — $${grandTotal.toFixed(2)}`}
        </button>
      </div>
    </main>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border px-3 py-2 text-sm"
      />
    </label>
  );
}
