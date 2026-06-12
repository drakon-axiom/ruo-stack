import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, OrderShipSchema } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireAdmin } from '../middleware/guards.js';
import { captureOrder, getWalletSummary } from '../services/wallet.js';
import { onOrderShipped } from '../hooks/order-shipped.js';
import { BadRequest, Conflict, NotFound } from '../errors.js';

/**
 * Operator fulfillment console (architecture §1.3). A control surface over the
 * order state machine: list the pre-ship queue, ship (which CAPTURES the wallet),
 * and mark delivered. Role-gated on the 'fulfillment' surface.
 */
export async function adminFulfillmentRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // Queue across all brands.
  app.get('/api/admin/orders', { preHandler: requireAdmin('fulfillment', 'view') }, async (req) => {
    const q = z
      .object({
        status: z.enum(['ready_for_fulfillment', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
      })
      .parse(req.query);
    const orders = await prisma.order.findMany({
      where: { ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { brand: { select: { brandName: true } }, items: true },
    });
    return {
      orders: orders.map((o) => ({
        id: o.id,
        brand_name: o.brand.brandName,
        status: o.status,
        blocker: o.blocker,
        recipient: { name: o.recipientName, city: o.city, state: o.state, zip: o.zip },
        item_count: o.items.length,
        wallet_charge_cents: o.walletChargeCents,
        tracking_number: o.trackingNumber,
        carrier: o.carrier,
        created_at: o.createdAt,
      })),
    };
  });

  // Ship — captures the wallet, records tracking, fires the writeback seam.
  app.post('/api/admin/orders/:id/ship', { preHandler: requireAdmin('fulfillment', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = OrderShipSchema.parse(req.body);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw NotFound('Order not found');
    if (order.status === 'shipped' || order.status === 'delivered') {
      throw Conflict('already_shipped', 'Order already shipped');
    }
    if (order.status === 'cancelled') throw BadRequest('cancelled', 'Cannot ship a cancelled order');

    // Re-check funds (covers orders placed while awaiting_funds).
    const { available } = await getWalletSummary(prisma, order.brandId);
    // For a blocker:none order the funds are already held (available excludes it),
    // so require available + (its own held) ≥ charge; simplest: balance must cover it.
    const reservedSelf = order.blocker === 'none' ? order.walletChargeCents : 0;
    if (available + reservedSelf < order.walletChargeCents) {
      throw BadRequest('insufficient_funds', "Brand's wallet can't cover this order — awaiting funds");
    }

    // Capture first (debits the wallet); if it fails, the order is not marked shipped.
    await captureOrder(prisma, order);

    const shipped = await prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id },
        data: {
          status: 'shipped',
          blocker: 'none',
          trackingNumber: body.tracking_number,
          carrier: body.carrier,
          shippedAt: new Date(),
        },
      });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.orderShipped,
        targetType: 'order',
        targetId: id,
        after: { tracking_number: body.tracking_number, carrier: body.carrier, captured_cents: o.walletChargeCents },
        ip: req.ip,
      });
      return o;
    });

    await onOrderShipped(shipped); // TODO(Phase 1.5): store tracking writeback
    return { ok: true, status: shipped.status, tracking_number: shipped.trackingNumber };
  });

  // Mark delivered.
  app.post('/api/admin/orders/:id/deliver', { preHandler: requireAdmin('fulfillment', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw NotFound('Order not found');
    if (order.status !== 'shipped') throw BadRequest('not_shipped', 'Only shipped orders can be delivered');

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: 'delivered', deliveredAt: new Date() } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.orderDelivered,
        targetType: 'order',
        targetId: id,
        ip: req.ip,
      });
    });
    return { ok: true };
  });
}
