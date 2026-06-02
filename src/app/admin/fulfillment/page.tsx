import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { FulfillmentTable, type FulfillOrder } from './FulfillmentTable';

export const dynamic = 'force-dynamic';

export default async function FulfillmentPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin/fulfillment');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  if (profile?.role !== 'admin') {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <h1 className="text-2xl font-bold">403 — Admins only</h1>
      </main>
    );
  }

  // All orders ready to ship (funds already debited). orders_admin_all RLS lets
  // an admin read across tenants; order_items embeds via its FK.
  const { data: orders } = await supabase
    .from('orders')
    .select(
      'id, user_id, customer_name, ship_name, ship_street, ship_city, ship_state, ship_zip, fulfillment_cost, created_at, order_items(product_name, sku, quantity)'
    )
    .eq('status', 'processing')
    .order('created_at', { ascending: true });

  // Attach the seller brand (no direct orders→profiles FK, so join in JS).
  const userIds = [...new Set((orders ?? []).map((o) => o.user_id))];
  const { data: sellers } = await supabase
    .from('profiles')
    .select('user_id, brand_name')
    .in('user_id', userIds.length ? userIds : ['']);
  const brandByUser = new Map((sellers ?? []).map((s) => [s.user_id, s.brand_name]));

  const rows: FulfillOrder[] = (orders ?? []).map((o) => ({
    id: o.id,
    brand_name: brandByUser.get(o.user_id) ?? '—',
    customer_name: o.customer_name,
    ship: [o.ship_street, o.ship_city, o.ship_state, o.ship_zip].filter(Boolean).join(', '),
    fulfillment_cost: Number(o.fulfillment_cost),
    created_at: o.created_at,
    items: (o.order_items ?? []).map((it: any) => ({
      product_name: it.product_name,
      sku: it.sku,
      quantity: it.quantity,
    })),
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fulfillment</h1>
          <p className="text-sm text-gray-500">
            {rows.length} order{rows.length === 1 ? '' : 's'} ready to ship. Select and buy labels.
          </p>
        </div>
        <a href="/admin" className="text-sm text-brand hover:underline">
          ← Admin
        </a>
      </header>

      <div className="mt-6">
        <FulfillmentTable orders={rows} />
      </div>
    </main>
  );
}
