import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, StatCard, Card, money } from '@/components/admin/ui';
import { AlertsList, type Alert } from './AlertsList';

export const dynamic = 'force-dynamic';

const QUICK_LINKS = [
  { href: '/admin/sellers', title: 'Sellers', desc: 'Subscriptions, bypass, wallet balances' },
  { href: '/admin/orders', title: 'Orders', desc: 'Refunds, status, tracking, notes' },
  { href: '/admin/fulfillment', title: 'Fulfillment', desc: 'Buy labels for ready orders' },
];

export default async function AdminPage() {
  // Admin gate enforced by admin/layout.tsx.
  const supabase = await createClient();

  const [
    { count: sellers },
    { count: openOrders },
    { count: totalOrders },
    { data: alerts },
    { data: wallets },
  ] = await Promise.all([
    supabase.from('profiles').select('user_id', { count: 'exact', head: true }).neq('role', 'admin'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['awaiting_funds', 'processing']),
    supabase.from('orders').select('id', { count: 'exact', head: true }),
    supabase
      .from('monitor_alerts')
      .select('id, category, created_at, details, order_id, user_id')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('wallets').select('balance'),
  ]);

  const walletFloat = (wallets ?? []).reduce(
    (s, w: { balance: number }) => s + Number(w.balance),
    0
  );
  const alertRows = (alerts ?? []) as Alert[];

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <PageHeader
        title="Admin"
        description="Platform health across every seller"
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sellers" value={sellers ?? 0} accent="ocean" />
        <StatCard label="Open orders" value={openOrders ?? 0} accent="warm" hint={`${totalOrders ?? 0} all-time`} />
        <StatCard label="Wallet float" value={money(walletFloat)} accent="sunset" />
        <StatCard
          label="Unresolved alerts"
          value={alertRows.length}
          hint={alertRows.length ? 'Needs attention' : 'All clear'}
        />
      </section>

      <section>
        <div className="grid gap-4 sm:grid-cols-3">
          {QUICK_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="group">
              <Card className="hover-lift flex h-full items-start justify-between gap-3 p-5">
                <div>
                  <p className="font-semibold">{l.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{l.desc}</p>
                </div>
                <span className="text-muted-foreground transition-transform group-hover:translate-x-0.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Monitor alerts</h2>
          {alertRows.length > 0 && (
            <span className="text-sm text-muted-foreground">{alertRows.length} unresolved</span>
          )}
        </div>
        <AlertsList alerts={alertRows} />
      </section>
    </main>
  );
}
