import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');

  // Server-side admin check. RLS also enforces this, but we gate the UI too.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="text-2xl font-bold">403 — Admins only</h1>
        <p className="mt-2 text-gray-500">Your account doesn’t have admin access.</p>
      </main>
    );
  }

  // Admin views read across tenants via the profiles_admin_all / orders_admin_all policies.
  const [{ count: sellers }, { count: openOrders }, { data: alerts }] = await Promise.all([
    supabase.from('profiles').select('user_id', { count: 'exact', head: true }),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['awaiting_funds', 'processing']),
    supabase
      .from('monitor_alerts')
      .select('category, created_at, details')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <a
          href="/admin/fulfillment"
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          Fulfillment →
        </a>
      </header>
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Sellers" value={sellers ?? 0} />
        <Stat label="Open orders" value={openOrders ?? 0} />
        <Stat label="Unresolved alerts" value={alerts?.length ?? 0} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Monitor alerts</h2>
        <ul className="mt-3 divide-y rounded-lg border">
          {(alerts ?? []).map((a, i) => (
            <li key={i} className="flex justify-between px-4 py-3 text-sm">
              <span className="font-mono text-xs">{a.category}</span>
              <span className="text-gray-500">{new Date(a.created_at).toLocaleString()}</span>
            </li>
          ))}
          {(alerts ?? []).length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-500">All clear.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}
