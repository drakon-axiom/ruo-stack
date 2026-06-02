// Buy a USPS/UPS/FedEx label via ShipStation for one or more orders, then mark
// them shipped with tracking. Only the order owner (or an admin) may buy a
// label for an order. ShipStation classic API uses HTTP Basic auth.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/client.ts';

const SS_BASE = 'https://ssapi.shipstation.com';

function ssAuthHeader(): string {
  const key = Deno.env.get('SHIPSTATION_API_KEY')!;
  const secret = Deno.env.get('SHIPSTATION_API_SECRET')!;
  return 'Basic ' + btoa(`${key}:${secret}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await requireUser(req);
    const { order_ids } = (await req.json()) as { order_ids: string[] };
    if (!Array.isArray(order_ids) || order_ids.length === 0) {
      return json({ error: 'order_ids required' }, 400);
    }

    const admin = adminClient();

    // ownership / admin check + load shipping details
    const { data: orders, error } = await admin
      .from('orders')
      .select(
        'id, user_id, status, ship_name, ship_street, ship_street2, ship_city, ship_state, ship_zip, ship_country, ship_phone'
      )
      .in('id', order_ids);
    if (error) throw error;

    const { data: me } = await admin.from('profiles').select('role').eq('user_id', userId).single();
    const isAdmin = me?.role === 'admin';

    // seller's return/from address
    const { data: profile } = await admin
      .from('profiles')
      .select('return_name, return_street, return_city, return_state, return_zip, return_phone')
      .eq('user_id', userId)
      .single();

    const results: Array<Record<string, unknown>> = [];
    for (const order of orders ?? []) {
      if (order.user_id !== userId && !isAdmin) {
        results.push({ order_id: order.id, error: 'forbidden' });
        continue;
      }
      if (order.status !== 'processing') {
        results.push({ order_id: order.id, error: `not shippable (status=${order.status})` });
        continue;
      }

      const resp = await fetch(`${SS_BASE}/shipments/createlabel`, {
        method: 'POST',
        headers: { Authorization: ssAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrierCode: 'stamps_com',
          serviceCode: 'usps_ground_advantage',
          packageCode: 'package',
          confirmation: 'none',
          shipDate: new Date().toISOString().slice(0, 10),
          weight: { value: 16, units: 'ounces' },
          shipFrom: {
            name: profile?.return_name ?? 'Fulfillment',
            street1: profile?.return_street ?? '',
            city: profile?.return_city ?? '',
            state: profile?.return_state ?? '',
            postalCode: profile?.return_zip ?? '',
            country: 'US',
            phone: profile?.return_phone ?? '',
          },
          shipTo: {
            name: order.ship_name,
            street1: order.ship_street,
            street2: order.ship_street2 ?? '',
            city: order.ship_city,
            state: order.ship_state,
            postalCode: order.ship_zip,
            country: order.ship_country ?? 'US',
            phone: order.ship_phone ?? '',
          },
          testLabel: (Deno.env.get('SHIPSTATION_TEST') ?? 'true') === 'true',
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        results.push({ order_id: order.id, error: `shipstation ${resp.status}: ${text}` });
        continue;
      }

      const label = await resp.json();
      await admin
        .from('orders')
        .update({
          status: 'shipped',
          carrier: 'usps',
          tracking_number: label.trackingNumber,
          label_url: label.labelData ? null : label.labelDownloadUrl ?? null,
          shipstation_order_id: String(label.orderId ?? ''),
        })
        .eq('id', order.id);

      results.push({ order_id: order.id, tracking_number: label.trackingNumber });
    }

    return json({ results });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
});
