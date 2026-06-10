import { createClient } from '@/lib/supabase/server';
import { PageHeader, StatCard, money } from '@/components/admin/ui';
import { SellersTable, type Subscriber } from './SellersTable';

export const dynamic = 'force-dynamic';

export default async function SellersPage() {
  // Admin gate enforced by admin/layout.tsx. Reads go through the admin-api
  // function because seller email lives in auth.users (service role only).
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action: 'list_subscribers' },
  });

  const subscribers: Subscriber[] = (data?.subscribers ?? []) as Subscriber[];
  const sellers = subscribers.filter((s) => s.role !== 'admin');

  const activeCount = sellers.filter(
    (s) => s.subscription_status === 'active' || s.subscription_bypass
  ).length;
  const bypassCount = sellers.filter((s) => s.subscription_bypass).length;
  const walletFloat = sellers.reduce((sum, s) => sum + Number(s.wallet_balance ?? 0), 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <PageHeader
        title="Sellers"
        description={`${sellers.length} seller${sellers.length === 1 ? '' : 's'} on the platform`}
      />

      {error ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          Couldn’t load sellers: {error.message}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Sellers" value={sellers.length} accent="ocean" />
            <StatCard
              label="Active access"
              value={activeCount}
              hint={`${bypassCount} via bypass`}
              accent="warm"
            />
            <StatCard label="Wallet float" value={money(walletFloat)} accent="sunset" />
            <StatCard
              label="Open orders"
              value={sellers.reduce((s, x) => s + (x.open_order_count ?? 0), 0)}
            />
          </section>

          <SellersTable subscribers={sellers} />
        </>
      )}
    </main>
  );
}
