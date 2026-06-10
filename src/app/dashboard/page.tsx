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
  const supabase = await createClient();
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
    supabase
      .from('profiles')
      .select('brand_name, logo_url, onboarding_complete, subscription_status, subscription_bypass')
      .single(),
  ]);

  // Finish setup before using the dashboard.
  if (profile && !profile.onboarding_complete) redirect('/onboarding');

  const balance = wallet?.balance ?? 0;
  const low = balance < (wallet?.low_balance_threshold ?? 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {profile?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo_url}
              alt=""
              className="h-12 w-12 rounded-lg border object-contain"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold">{profile?.brand_name ?? 'Your brand'}</h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <a
          href="/dashboard/orders/new"
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          New order
        </a>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className={`rounded-lg border p-5 ${low ? 'border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40' : ''}`}>
          <p className="text-sm text-muted-foreground">Wallet balance</p>
          <p className="mt-1 text-3xl font-bold">${Number(balance).toFixed(2)}</p>
          {low && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Low balance — top up to avoid parked orders.</p>}
          <a href="/checkout" className="mt-3 inline-block rounded bg-brand px-3 py-1.5 text-sm text-white">
            Add funds
          </a>
        </div>
        <div className="rounded-lg border p-5">
          <p className="text-sm text-muted-foreground">Open orders</p>
          <p className="mt-1 text-3xl font-bold">
            {(orders ?? []).filter((o) => !['delivered', 'fulfilled', 'cancelled', 'refunded'].includes(o.status)).length}
          </p>
        </div>
        <div className="rounded-lg border p-5">
          <p className="text-sm text-muted-foreground">Recent orders</p>
          <p className="mt-1 text-3xl font-bold">{orders?.length ?? 0}</p>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Orders</h2>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
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
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
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
