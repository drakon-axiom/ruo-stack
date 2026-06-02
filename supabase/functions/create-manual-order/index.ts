// Place a manual order from the seller dashboard. Line-item costs are looked
// up from the catalog server-side (never trusted from the client), the order +
// items are written, then fulfill_order() atomically debits the wallet or
// parks the order at awaiting_funds.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/client.ts';

interface LineInput {
  variant_id: string;
  quantity: number;
}
interface OrderInput {
  customer_name: string;
  customer_email?: string;
  shipping_cost?: number;
  ship_street?: string;
  ship_city?: string;
  ship_state?: string;
  ship_zip?: string;
  items: LineInput[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await requireUser(req);
    const input = (await req.json()) as OrderInput;

    if (!input.customer_name || !Array.isArray(input.items) || input.items.length === 0) {
      return json({ error: 'customer_name and at least one item are required' }, 400);
    }

    const admin = adminClient();

    // server-side price lookup for every requested variant
    const variantIds = input.items.map((i) => i.variant_id);
    const { data: variants, error: vErr } = await admin
      .from('product_variants')
      .select('id, sku, size, wholesale_cost, in_stock, products(name)')
      .in('id', variantIds);
    if (vErr) throw vErr;

    const byId = new Map((variants ?? []).map((v) => [v.id, v]));
    for (const item of input.items) {
      const v = byId.get(item.variant_id);
      if (!v) return json({ error: `unknown variant ${item.variant_id}` }, 400);
      if (!v.in_stock) return json({ error: `out of stock: ${v.sku}` }, 409);
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        return json({ error: `bad quantity for ${v.sku}` }, 400);
      }
    }

    // create the order
    const { data: order, error: oErr } = await admin
      .from('orders')
      .insert({
        user_id: userId,
        source: 'manual',
        status: 'pending',
        customer_name: input.customer_name,
        customer_email: input.customer_email ?? null,
        ship_name: input.customer_name,
        ship_street: input.ship_street ?? null,
        ship_city: input.ship_city ?? null,
        ship_state: input.ship_state ?? null,
        ship_zip: input.ship_zip ?? null,
        shipping_cost: Number(input.shipping_cost ?? 0),
      })
      .select('id')
      .single();
    if (oErr) throw oErr;

    // insert line items with snapshotted costs
    const rows = input.items.map((i) => {
      const v = byId.get(i.variant_id)!;
      return {
        order_id: order.id,
        variant_id: v.id,
        product_name: (v.products as { name: string } | null)?.name ?? v.sku,
        sku: v.sku,
        quantity: i.quantity,
        unit_cost: v.wholesale_cost,
      };
    });
    const { error: liErr } = await admin.from('order_items').insert(rows);
    if (liErr) throw liErr;

    // attempt fulfillment (atomic wallet debit, or park at awaiting_funds)
    const { data: status, error: fErr } = await admin.rpc('fulfill_order', {
      p_order_id: order.id,
    });
    if (fErr) throw fErr;

    return json({ order_id: order.id, status });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
});
