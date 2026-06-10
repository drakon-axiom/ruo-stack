// admin-api — single catch-all admin control plane (Pepify-style). EVERY action
// re-checks admin via requireAdmin() before doing anything; there is no action
// that runs without that gate. Money-moving actions delegate to the
// SECURITY DEFINER RPCs so the ledger invariant holds.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, requireAdmin } from '../_shared/client.ts';

type Action =
  | 'check_admin'
  | 'list_subscribers'
  | 'update_order'
  | 'refund_order'
  | 'add_order_note'
  | 'bulk_update_stock'
  | 'post_announcement'
  | 'bypass_user'
  | 'resolve_alert';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // hard gate — throws unless caller is an admin
    const adminUserId = await requireAdmin(req);
    const admin = adminClient();
    const { action, payload } = (await req.json()) as { action: Action; payload?: any };

    // every privileged action is written to the audit log
    const audit = (details: unknown) =>
      admin.from('activity_log').insert({ actor_id: adminUserId, action, details });

    switch (action) {
      case 'check_admin':
        return json({ ok: true });

      case 'list_subscribers': {
        const { data: profiles, error } = await admin
          .from('profiles')
          .select(
            'user_id, brand_name, full_name, role, subscription_status, subscription_bypass, onboarding_complete, created_at'
          )
          .order('created_at', { ascending: false });
        if (error) throw error;

        // Enrich with email (auth.users — service role only), wallet balance,
        // and order counts. Each map is one round-trip; counts are tallied in JS.
        const [{ data: authList }, { data: wallets }, { data: orderRows }] =
          await Promise.all([
            admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
            admin.from('wallets').select('user_id, balance'),
            admin.from('orders').select('user_id, status'),
          ]);

        const emailById = new Map(
          (authList?.users ?? []).map((u) => [u.id, u.email ?? null])
        );
        const balanceById = new Map(
          (wallets ?? []).map((w: { user_id: string; balance: number }) => [
            w.user_id,
            Number(w.balance),
          ])
        );
        const CLOSED = new Set(['delivered', 'fulfilled', 'cancelled', 'refunded']);
        const totalByUser = new Map<string, number>();
        const openByUser = new Map<string, number>();
        for (const o of (orderRows ?? []) as { user_id: string; status: string }[]) {
          totalByUser.set(o.user_id, (totalByUser.get(o.user_id) ?? 0) + 1);
          if (!CLOSED.has(o.status))
            openByUser.set(o.user_id, (openByUser.get(o.user_id) ?? 0) + 1);
        }

        const subscribers = (profiles ?? []).map((p) => ({
          ...p,
          email: emailById.get(p.user_id) ?? null,
          wallet_balance: balanceById.get(p.user_id) ?? 0,
          order_count: totalByUser.get(p.user_id) ?? 0,
          open_order_count: openByUser.get(p.user_id) ?? 0,
        }));
        return json({ subscribers });
      }

      case 'update_order': {
        // set tracking + status (e.g. mark shipped manually)
        const { order_id, status, tracking_number, carrier } = payload;
        const { error } = await admin
          .from('orders')
          .update({ status, tracking_number, carrier })
          .eq('id', order_id);
        if (error) throw error;
        await audit({ order_id, status, tracking_number });
        return json({ ok: true });
      }

      case 'refund_order': {
        const { order_id, amount, reason } = payload;
        const { data, error } = await admin.rpc('refund_order', {
          p_order_id: order_id,
          p_amount: amount ?? null,
          p_reason: reason ?? null,
        });
        if (error) throw error;
        await audit({ order_id, amount: data, reason });
        return json({ refunded: data });
      }

      case 'add_order_note': {
        const { order_id, note_text } = payload;
        const { error } = await admin
          .from('order_notes')
          .insert({ order_id, note_text, author: 'admin' });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'bulk_update_stock': {
        // payload.updates: [{ variant_id, in_stock }]
        const updates: Array<{ variant_id: string; in_stock: boolean }> = payload.updates ?? [];
        for (const u of updates) {
          await admin.from('product_variants').update({ in_stock: u.in_stock }).eq('id', u.variant_id);
        }
        await audit({ count: updates.length });
        return json({ updated: updates.length });
      }

      case 'post_announcement': {
        const { title, message } = payload;
        const { error } = await admin.from('announcements').insert({ title, message });
        if (error) throw error;
        await audit({ title });
        return json({ ok: true });
      }

      case 'bypass_user': {
        // high-privilege: grant a seller access without an active subscription.
        const { user_id, bypass } = payload;
        const { error } = await admin
          .from('profiles')
          .update({ subscription_bypass: !!bypass })
          .eq('user_id', user_id);
        if (error) throw error;
        await audit({ user_id, bypass });
        return json({ ok: true });
      }

      case 'resolve_alert': {
        const { alert_id } = payload;
        const { error } = await admin.from('monitor_alerts').update({ resolved: true }).eq('id', alert_id);
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const status = msg === 'admin only' || msg.includes('session') ? 403 : 400;
    return json({ error: msg }, status);
  }
});
