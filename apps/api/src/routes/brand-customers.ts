import type { FastifyInstance } from 'fastify';
import { getClients } from '../clients.js';
import { requireBrand } from '../middleware/guards.js';

/**
 * Customers — a READ-ONLY CRM view derived from the brand's own orders. There is
 * no Customer table: recipients live inline on Order, so we fold the brand's
 * non-cancelled orders into per-recipient aggregates (grouped by email, falling
 * back to name+zip when an order has no email). "Spend" is fulfillment cost (sum
 * of wallet charges) — the retail a customer actually paid is not stored per
 * order. Every query is scoped to req.brand!.brandId. No new data model.
 */
export async function brandCustomerRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  app.get('/api/brand/customers', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;

    // Cancelled orders released their reservation and never fulfilled — exclude
    // them so counts + spend reflect real transactions.
    const orders = await prisma.order.findMany({
      where: { brandId, status: { not: 'cancelled' } },
      orderBy: { createdAt: 'desc' }, // newest first → first-seen row per key is the latest
      select: {
        id: true,
        recipientName: true,
        recipientEmail: true,
        recipientPhone: true,
        city: true,
        state: true,
        zip: true,
        country: true,
        walletChargeCents: true,
        status: true,
        blocker: true,
        trackingNumber: true,
        exportedAt: true,
        createdAt: true,
      },
    });

    type Customer = {
      key: string;
      name: string;
      email: string | null;
      phone: string | null;
      city: string;
      state: string;
      country: string;
      orders: number;
      spend_cents: number;
      first_order: Date;
      last_order: Date;
      last_status: string;
      last_blocker: string;
      last_exported_at: Date | null;
      order_list: {
        id: string;
        status: string;
        blocker: string;
        wallet_charge_cents: number;
        tracking_number: string | null;
        exported_at: Date | null;
        created_at: Date;
      }[];
    };

    const byKey = new Map<string, Customer>();
    for (const o of orders) {
      const email = o.recipientEmail?.trim().toLowerCase() || null;
      const key = email ?? `name:${o.recipientName.trim().toLowerCase()}|${o.zip}`;
      let c = byKey.get(key);
      if (!c) {
        // First row for this key is the newest order (list is desc) — seed the
        // customer's identity/location from it.
        c = {
          key,
          name: o.recipientName,
          email,
          phone: o.recipientPhone || null,
          city: o.city,
          state: o.state,
          country: o.country,
          orders: 0,
          spend_cents: 0,
          first_order: o.createdAt,
          last_order: o.createdAt,
          last_status: o.status,
          last_blocker: o.blocker,
          last_exported_at: o.exportedAt,
          order_list: [],
        };
        byKey.set(key, c);
      }
      c.orders += 1;
      c.spend_cents += o.walletChargeCents;
      if (o.createdAt < c.first_order) c.first_order = o.createdAt;
      if (!c.phone && o.recipientPhone) c.phone = o.recipientPhone; // backfill from any order
      c.order_list.push({
        id: o.id,
        status: o.status,
        blocker: o.blocker,
        wallet_charge_cents: o.walletChargeCents,
        tracking_number: o.trackingNumber,
        exported_at: o.exportedAt,
        created_at: o.createdAt,
      });
    }

    const customers = Array.from(byKey.values()).sort(
      (a, b) => b.last_order.getTime() - a.last_order.getTime(),
    );

    return {
      customers,
      totals: {
        customers: customers.length,
        orders: orders.length,
        spend_cents: customers.reduce((s, c) => s + c.spend_cents, 0),
      },
    };
  });
}
