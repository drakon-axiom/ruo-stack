'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const PRESETS = [100, 250, 500, 1000];

export default function CheckoutPage() {
  const supabase = createClient();
  const [amount, setAmount] = useState(250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function topUp() {
    setBusy(true);
    setError(null);
    // create-wallet-checkout returns a Stripe Checkout URL. The amount is
    // validated server-side; the wallet is credited only by the webhook.
    const { data, error } = await supabase.functions.invoke('create-wallet-checkout', {
      body: { amount },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data?.url) window.location.href = data.url;
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold">Add funds to your wallet</h1>
      <p className="mt-2 text-sm text-gray-500">
        Prepaid store credit. $1 minimum, never expires. Each fulfilled order debits
        wholesale cost + shipping.
      </p>

      <div className="mt-6 grid grid-cols-4 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(p)}
            className={`rounded border py-2 text-sm ${
              amount === p ? 'border-brand bg-brand text-white' : ''
            }`}
          >
            ${p}
          </button>
        ))}
      </div>

      <input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
        className="mt-4 w-full rounded border px-3 py-2"
      />

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={topUp}
        disabled={busy}
        className="mt-6 w-full rounded bg-brand py-3 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Redirecting…' : `Continue to payment — $${amount}`}
      </button>
    </main>
  );
}
