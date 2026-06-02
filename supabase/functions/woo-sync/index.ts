// woo-sync — WooCommerce integration.
//
// Actions:
//   connect         { store_url, consumer_key, consumer_secret }  test + store (encrypted)
//   test_connection                                               verify stored creds
//   sync_products                                                 Woo products -> synced_products
//   sync_orders                                                   Woo orders  -> orders/order_items -> fulfill
//   push_tracking                                                 push tracking back to Woo (shipped orders)
//   disconnect                                                    deactivate the connection
//
// Money is server-authoritative: line-item unit_cost is taken from OUR catalog
// (matched by SKU), never from the Woo order. Unmatched SKUs raise an
// 'unsupported_product' monitor alert and the order is skipped.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/client.ts';
import { encryptJson, decryptJson } from '../_shared/crypto.ts';

const PLATFORM = 'woocommerce';

interface WooCreds {
  consumer_key: string;
  consumer_secret: string;
}

function wooUrl(storeUrl: string, path: string): string {
  return `${storeUrl.replace(/\/+$/, '')}/wp-json/wc/v3/${path}`;
}
function wooAuth(c: WooCreds): string {
  return 'Basic ' + btoa(`${c.consumer_key}:${c.consumer_secret}`);
}
async function wooFetch(storeUrl: string, creds: WooCreds, path: string, init: RequestInit = {}) {
  return fetch(wooUrl(storeUrl, path), {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: wooAuth(creds), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await requireUser(req);
    const admin = adminClient();
    const { action, payload } = (await req.json()) as { action: string; payload?: any };

    // ---- connect: validate creds against the store, then store encrypted ----
    if (action === 'connect') {
      const { store_url, consumer_key, consumer_secret } = payload ?? {};
      if (!store_url || !consumer_key || !consumer_secret) {
        return json({ error: 'store_url, consumer_key, consumer_secret required' }, 400);
      }
      const creds: WooCreds = { consumer_key, consumer_secret };

      // probe: list 1 product to confirm the credentials work + have read scope
      const probe = await wooFetch(store_url, creds, 'products?per_page=1');
      if (!probe.ok) {
        const text = await probe.text();
        return json({ error: `WooCommerce auth failed (${probe.status}): ${text.slice(0, 200)}` }, 400);
      }

      const credentials_encrypted = await encryptJson(creds);
      const { error } = await admin
        .from('store_connections')
        .upsert(
          {
            user_id: userId,
            platform: PLATFORM,
            store_url: store_url.replace(/\/+$/, ''),
            credentials_encrypted,
            is_active: true,
          },
          { onConflict: 'user_id,platform,store_url' }
        );
      if (error) throw error;
      return json({ ok: true });
    }

    // ---- everything else needs an existing active connection ----
    const { data: conn } = await admin
      .from('store_connections')
      .select('id, store_url, credentials_encrypted, last_synced_at')
      .eq('user_id', userId)
      .eq('platform', PLATFORM)
      .eq('is_active', true)
      .maybeSingle();

    if (action === 'disconnect') {
      if (conn) await admin.from('store_connections').update({ is_active: false }).eq('id', conn.id);
      return json({ ok: true });
    }

    if (!conn) return json({ error: 'no active WooCommerce connection' }, 404);
    const creds = await decryptJson<WooCreds>(conn.credentials_encrypted);

    const started = Date.now();
    const logSync = (kind: string, status: string, items: number, err?: string) =>
      admin.from('sync_logs').insert({
        user_id: userId,
        kind,
        status,
        items_synced: items,
        error_message: err ?? null,
        duration_ms: Date.now() - started,
        started_at: new Date(started).toISOString(),
      });

    switch (action) {
      case 'test_connection': {
        const resp = await wooFetch(conn.store_url, creds, 'products?per_page=1');
        return json({ ok: resp.ok, status: resp.status });
      }

      case 'sync_products': {
        const resp = await wooFetch(conn.store_url, creds, 'products?per_page=100&status=publish');
        if (!resp.ok) {
          await logSync('products', 'error', 0, `HTTP ${resp.status}`);
          return json({ error: `Woo products ${resp.status}` }, 502);
        }
        const products = (await resp.json()) as any[];
        const rows = products.map((p) => ({
          user_id: userId,
          connection_id: conn.id,
          external_id: String(p.id),
          name: p.name,
          sku: p.sku || null,
          image_url: p.images?.[0]?.src ?? null,
          price: p.price ? Number(p.price) : null,
          stock_status: p.stock_status ?? null,
          status: p.status ?? null,
          updated_at: new Date().toISOString(),
        }));
        if (rows.length) await admin.from('synced_products').upsert(rows, { onConflict: 'id' });
        await admin.from('store_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', conn.id);
        await logSync('products', 'ok', rows.length);
        return json({ ok: true, items_synced: rows.length });
      }

      case 'sync_orders': {
        // pull recent orders (incremental after last_synced_at if present)
        const after = conn.last_synced_at ? `&after=${encodeURIComponent(conn.last_synced_at)}` : '';
        const resp = await wooFetch(
          conn.store_url,
          creds,
          `orders?per_page=50&status=processing${after}`
        );
        if (!resp.ok) {
          await logSync('orders', 'error', 0, `HTTP ${resp.status}`);
          return json({ error: `Woo orders ${resp.status}` }, 502);
        }
        const wooOrders = (await resp.json()) as any[];

        // which of these have we already imported?
        const extIds = wooOrders.map((o) => String(o.id));
        const { data: existing } = await admin
          .from('orders')
          .select('external_order_id')
          .eq('user_id', userId)
          .eq('source', PLATFORM)
          .in('external_order_id', extIds.length ? extIds : ['']);
        const seen = new Set((existing ?? []).map((e) => e.external_order_id));

        let imported = 0;
        const results: Array<Record<string, unknown>> = [];

        for (const wo of wooOrders) {
          const ext = String(wo.id);
          if (seen.has(ext)) continue;

          // match each line item SKU against our catalog (server-authoritative cost)
          const skus = (wo.line_items ?? []).map((li: any) => li.sku).filter(Boolean);
          const { data: variants } = await admin
            .from('product_variants')
            .select('id, sku, wholesale_cost, in_stock, products(name)')
            .in('sku', skus.length ? skus : ['']);
          const bySku = new Map((variants ?? []).map((v) => [v.sku, v]));

          const unmatched = (wo.line_items ?? []).filter((li: any) => !li.sku || !bySku.has(li.sku));
          if (unmatched.length) {
            await admin.from('monitor_alerts').insert({
              category: 'unsupported_product',
              user_id: userId,
              details: { woo_order: ext, skus: unmatched.map((u: any) => u.sku ?? u.name) },
            });
            results.push({ woo_order: ext, skipped: 'unsupported_product' });
            continue;
          }

          const ship = wo.shipping ?? {};
          const bill = wo.billing ?? {};
          const { data: order, error: oErr } = await admin
            .from('orders')
            .insert({
              user_id: userId,
              source: PLATFORM,
              external_order_id: ext,
              status: 'pending',
              customer_name: `${ship.first_name ?? bill.first_name ?? ''} ${ship.last_name ?? bill.last_name ?? ''}`.trim() || 'Customer',
              customer_email: bill.email ?? null,
              ship_name: `${ship.first_name ?? ''} ${ship.last_name ?? ''}`.trim() || null,
              ship_street: ship.address_1 ?? null,
              ship_street2: ship.address_2 ?? null,
              ship_city: ship.city ?? null,
              ship_state: ship.state ?? null,
              ship_zip: ship.postcode ?? null,
              ship_country: ship.country ?? 'US',
              ship_phone: bill.phone ?? null,
              order_total: wo.total ? Number(wo.total) : null,
            })
            .select('id')
            .single();
          if (oErr) {
            // unique violation = a concurrent import already created it; skip
            if ((oErr as any).code === '23505') continue;
            throw oErr;
          }

          const items = (wo.line_items ?? []).map((li: any) => {
            const v = bySku.get(li.sku)!;
            return {
              order_id: order.id,
              variant_id: v.id,
              product_name: (v.products as { name: string } | null)?.name ?? li.name,
              sku: li.sku,
              quantity: li.quantity,
              unit_cost: v.wholesale_cost,
            };
          });
          await admin.from('order_items').insert(items);

          const { data: status } = await admin.rpc('fulfill_order', { p_order_id: order.id });
          imported++;
          results.push({ woo_order: ext, order_id: order.id, status });
        }

        await admin.from('store_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', conn.id);
        await logSync('orders', 'ok', imported);
        return json({ ok: true, imported, results });
      }

      case 'push_tracking': {
        // push tracking back to Woo for shipped orders not yet pushed
        const { data: shipped } = await admin
          .from('orders')
          .select('id, external_order_id, tracking_number, carrier')
          .eq('user_id', userId)
          .eq('source', PLATFORM)
          .eq('status', 'shipped')
          .not('tracking_number', 'is', null);

        let pushed = 0;
        for (const o of shipped ?? []) {
          // guard against re-push: skip if we already noted it
          const { count } = await admin
            .from('order_notes')
            .select('id', { count: 'exact', head: true })
            .eq('order_id', o.id)
            .eq('note_text', `Tracking pushed to Woo: ${o.tracking_number}`);
          if (count) continue;

          const resp = await wooFetch(conn.store_url, creds, `orders/${o.external_order_id}/notes`, {
            method: 'POST',
            body: JSON.stringify({
              note: `Shipped via ${o.carrier ?? 'carrier'}. Tracking: ${o.tracking_number}`,
              customer_note: true,
            }),
          });
          if (resp.ok) {
            await admin
              .from('order_notes')
              .insert({ order_id: o.id, author: 'system', note_text: `Tracking pushed to Woo: ${o.tracking_number}` });
            pushed++;
          }
        }
        await logSync('tracking', 'ok', pushed);
        return json({ ok: true, pushed });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
});
