import { createClient } from '@/lib/supabase/server';
import { PageHeader, StatCard, money } from '@/components/admin/ui';
import { OrdersTable, type AdminOrder } from './OrdersTable';

export const dynamic = 'force-dynamic';

const OPEN = ['pending', 'awaiting_funds', 'processing'];

export default async function AdminOrdersPage() {
  // Admin gate enforced by admin/layout.tsx. orders_admin_all + order_notes_read
  // RLS let an admin read across tenants; items/notes embed via FK.
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from('orders')
    .select(
      'id, user_id, source, status, customer_name, customer_email, ship_name, ship_street, ship_street2, ship_city, ship_state, ship_zip, ship_country, ship_phone, fulfillment_cost, shipping_cost, order_total, carrier, tracking_number, created_at, order_items(product_name, sku, quantity), order_notes(note_text, author, created_at)'
    )
    .order('created_at', { ascending: false })
    .limit(200);

  const userIds = [...new Set((orders ?? []).map((o) => o.user_id))];
  const { data: sellers } = await supabase
    .from('profiles')
    .select('user_id, brand_name')
    .in('user_id', userIds.length ? userIds : ['']);
  const brandByUser = new Map((sellers ?? []).map((s) => [s.user_id, s.brand_name]));

  const rows: AdminOrder[] = (orders ?? []).map((o) => ({
    id: o.id,
    brand_name: brandByUser.get(o.user_id) ?? '—',
    source: o.source,
    status: o.status,
    customer_name: o.customer_name,
    customer_email: o.customer_email,
    ship_name: o.ship_name,
    ship_street: o.ship_street,
    ship_street2: o.ship_street2,
    ship_city: o.ship_city,
    ship_state: o.ship_state,
    ship_zip: o.ship_zip,
    ship_country: o.ship_country,
    ship_phone: o.ship_phone,
    fulfillment_cost: Number(o.fulfillment_cost),
    shipping_cost: Number(o.shipping_cost),
    order_total: o.order_total == null ? null : Number(o.order_total),
    carrier: o.carrier,
    tracking_number: o.tracking_number,
    created_at: o.created_at,
    items: (o.order_items ?? []).map((it: { product_name: string; sku: string | null; quantity: number }) => ({
      product_name: it.product_name,
      sku: it.sku,
      quantity: it.quantity,
    })),
    notes: (o.order_notes ?? [])
      .map((n: { note_text: string; author: string | null; created_at: string }) => ({
        note_text: n.note_text,
        author: n.author,
        created_at: n.created_at,
      }))
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
  }));

  const openCount = rows.filter((o) => OPEN.includes(o.status)).length;
  const refundedCount = rows.filter((o) => o.status === 'refunded').length;
  const debited = rows.reduce((s, o) => s + o.fulfillment_cost, 0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <PageHeader title="Orders" description="Every order across all sellers (latest 200)" />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={rows.length} accent="ocean" />
        <StatCard label="Open" value={openCount} accent="warm" />
        <StatCard label="Fulfillment debited" value={money(debited)} accent="sunset" />
        <StatCard label="Refunded" value={refundedCount} />
      </section>

      <OrdersTable orders={rows} />
    </main>
  );
}
