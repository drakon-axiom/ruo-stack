// woo-sync — WooCommerce integration (stub). Actions: test_connection,
// sync_orders, sync_products, push_tracking. Credentials are decrypted from
// store_connections.credentials_encrypted server-side; new orders are
// idempotently upserted on (user_id, source, external_order_id), then
// fulfill_order() is called for each.
//
// TODO: implement WooCommerce REST calls (consumer key/secret, Basic auth).
// This stub wires up the shape so the dashboard "Connect store" flow has a
// real endpoint to call.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/client.ts';

type Action = 'test_connection' | 'sync_orders' | 'sync_products' | 'push_tracking';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await requireUser(req);
    const { action } = (await req.json()) as { action: Action };
    const admin = adminClient();

    const started = Date.now();
    let itemsSynced = 0;

    switch (action) {
      case 'test_connection':
        // TODO: GET {store_url}/wp-json/wc/v3/system_status with the stored key
        return json({ ok: true, note: 'stub — wire up WooCommerce REST here' });

      case 'sync_orders':
        // TODO: pull orders, upsert into `orders`, insert `order_items`,
        // then call rpc('fulfill_order', ...) per new order.
        itemsSynced = 0;
        break;

      case 'sync_products':
        // TODO: pull products -> synced_products
        itemsSynced = 0;
        break;

      case 'push_tracking':
        // TODO: push tracking_number back to Woo for shipped orders
        itemsSynced = 0;
        break;

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }

    await admin.from('sync_logs').insert({
      user_id: userId,
      kind: action,
      status: 'ok',
      items_synced: itemsSynced,
      duration_ms: Date.now() - started,
      started_at: new Date(started).toISOString(),
    });

    return json({ ok: true, items_synced: itemsSynced });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
});
