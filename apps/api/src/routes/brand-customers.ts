import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getClients } from '../clients.ts';
import { requireBrand } from '../middleware/guards.ts';
import { customerKey, foldCustomers } from '../services/customers.ts';

/**
 * Customers — a READ-ONLY CRM view derived from the brand's own orders. There is
 * no Customer table: recipients live inline on Order, so we fold the brand's
 * non-cancelled orders into per-recipient aggregates (grouped by email, falling
 * back to name+zip when an order has no email). "Spend" is fulfillment cost (sum
 * of wallet charges) — the retail a customer actually paid is not stored per
 * order. Every query is scoped to req.brand!.brandId. No new data model.
 *
 * The rollup itself is a pure function in `services/customers.ts`; this owns the
 * query and the scan cap.
 */
// Cap the order scan so a very high-volume brand can't OOM the process by
// materialising + grouping every order in memory. We take the most-recent slice;
// when it's hit, the response flags `truncated` so the omission isn't silent.
// (A future SQL GROUP-BY rollup would remove the cap entirely — see POLISH_TODO.)
const MAX_ORDER_SCAN = 5000;

export async function brandCustomerRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  app.get('/api/brand/customers', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const query = z.object({
      view: z.enum(['summary', 'history']).optional(),
      customer_key: z.string().min(1).max(1000).optional(),
    }).refine(q => q.view !== 'history' || q.customer_key !== undefined, { message: 'History requires a customer key' }).parse(req.query);

    // Cancelled orders released their reservation and never fulfilled — exclude
    // them so counts + spend reflect real transactions.
    const orders = await prisma.order.findMany({
      where: { brandId, status: { not: 'cancelled' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // newest first → first-seen row per key is the latest
      take: MAX_ORDER_SCAN + 1, // +1 sentinel to detect truncation
      select: {
        id: true,
        recipientName: true,
        recipientEmail: true,
        recipientPhone: true,
        // address1/address2 back the "ship again" prefill — they are the brand's
        // own order data, already visible to it on the Orders screen.
        address1: true,
        address2: true,
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

    // Drop the sentinel row; if it was present the scan was capped.
    const truncated = orders.length > MAX_ORDER_SCAN;
    if (truncated) orders.length = MAX_ORDER_SCAN;

    // Filter only after the shared scan cap, so a drawer describes the same
    // reporting window as the list. Never accept a caller-supplied brand id.
    const selected = query.view === 'history' ? orders.filter(o => customerKey(o) === query.customer_key) : orders;
    const customers = foldCustomers(selected, { includeHistory: query.view !== 'summary' });

    return {
      customers,
      totals: {
        customers: customers.length,
        orders: selected.length,
        spend_cents: customers.reduce((s, c) => s + c.spend_cents, 0),
        // True when older orders were omitted by the scan cap (rollup is over the
        // most-recent MAX_ORDER_SCAN orders only).
        truncated,
      },
    };
  });
}
