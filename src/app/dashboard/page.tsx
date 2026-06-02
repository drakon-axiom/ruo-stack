import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  awaiting_funds: '💰 Awaiting funds',
  processing: '📦 Processing',
  shipped: 'Shipped',
  delivered: '✅ Delivered',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  // RLS guarantees these only return the signed-in seller's rows.
  const [{ data: wallet }, { data: orders }, { data: profile }] = await Promise.all([
    supabase.from('wallets').select('balance, low_balance_threshold').single(),
    supabase
      .from('orders')
      .select('id, customer_name, status, fulfillment_cost, tracking_number, created_at')
      .order('created_at', { ascending: false })
      .limit(25),
    supabase.from('profiles').select('brand_name, subscription_status, subscription_bypass').single(),
  ]);

  const balance = wallet?.balance ?? 0;
  const low = balance < (wallet?.low_balance_threshold ?? 0);
  const active =
    profile?.subscription_status === 'active' || profile?.subscription_bypass;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{profile?.brand_name ?? 'Your brand'}</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${
            active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}
        >
          {active ? 'Pro active' : 'Subscription inactive'}
        </span>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className={`rounded-lg border p-5 ${low ? 'border-amber-400 bg-amber-50' : ''}`}>
          <p className="text-sm text-gray-500">Wallet balance</p>
          <p className="mt-1 text-3xl font-bold">${Number(balance).toFixed(2)}</p>
          {low && <p className="mt-1 text-xs text-amber-700">Low balance — top up to avoid parked orders.</p>}
          <a href="/checkout" className="mt-3 inline-block rounded bg-brand px-3 py-1.5 text-sm text-white">
            Add funds
          </a>
        </div>
        <div className="rounded-lg border p-5">
          <p className="text-sm text-gray-500">Open orders</p>
          <p className="mt-1 text-3xl font-bold">
            {(orders ?? []).filter((o) => !['delivered', 'fulfilled', 'cancelled', 'refunded'].includes(o.status)).length}
          </p>
        </div>
        <div className="rounded-lg border p-5">
          <p className="text-sm text-gray-500">Recent orders</p>
          <p className="mt-1 text-3xl font-bold">{orders?.length ?? 0}</p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Orders</h2>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Cost</th>
                <th className="px-4 py-2">Tracking</th>
                <th className="px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-4 py-2">{o.customer_name}</td>
                  <td className="px-4 py-2">{STATUS_LABEL[o.status] ?? o.status}</td>
                  <td className="px-4 py-2">${Number(o.fulfillment_cost).toFixed(2)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{o.tracking_number ?? '—'}</td>
                  <td className="px-4 py-2">{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {(orders ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
