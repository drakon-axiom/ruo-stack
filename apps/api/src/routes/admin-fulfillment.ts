import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, OrderEditSchema, OrderShipSchema } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { captureOrder, getWalletSummary } from '../services/wallet.ts';
import { applyOrderEdit } from '../services/order-edit.ts';
import { onOrderShipped } from '../hooks/order-shipped.ts';
import { BadRequest, Conflict, NotFound } from '../errors.ts';

/**
 * Operator fulfillment console (architecture §1.3). Fulfillment itself happens in
 * ShipStation via the Custom Store (export + shipnotify) — this surface is a
 * read-only MONITOR plus two failsafes for when something goes sideways:
 *   • Re-send: re-queue an order into ShipStation's next export pull.
 *   • Manual mark-shipped: capture the wallet + record tracking when a label was
 *     made outside ShipStation or shipnotify never arrived.
 * Role-gated on the 'fulfillment' surface.
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
        shipping_service_code: o.shippingServiceCode,
        tracking_number: o.trackingNumber,
        carrier: o.carrier,
        exported_at: o.exportedAt,
        shipped_at: o.shippedAt,
        created_at: o.createdAt,
      })),
    };
  });

  // Full detail (for the edit drawer).
  app.get('/api/admin/orders/:id', { preHandler: requireAdmin('fulfillment', 'view') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const o = await prisma.order.findUnique({
      where: { id },
      include: { brand: { select: { brandName: true } }, items: true },
    });
    if (!o) throw NotFound('Order not found');
    return {
      id: o.id,
      brand_name: o.brand.brandName,
      status: o.status,
      blocker: o.blocker,
      recipient: {
        name: o.recipientName,
        email: o.recipientEmail,
        phone: o.recipientPhone,
        address1: o.address1,
        address2: o.address2,
        city: o.city,
        state: o.state,
        zip: o.zip,
        country: o.country,
      },
      wholesale_total_cents: o.wholesaleTotalCents,
      shipping_total_cents: o.shippingTotalCents,
      wallet_charge_cents: o.walletChargeCents,
      shipping_service_code: o.shippingServiceCode,
      box_name: o.boxName,
      billable_weight_oz: o.billableWeightOz,
      box_dims: o.boxLengthIn != null ? { l: o.boxLengthIn, w: o.boxWidthIn, h: o.boxHeightIn } : null,
      tracking_number: o.trackingNumber,
      carrier: o.carrier,
      exported_at: o.exportedAt,
      created_at: o.createdAt,
      items: o.items.map((i) => ({ id: i.id, product_id: i.productId, qty: i.qty, unit_wholesale_cents: i.unitWholesaleCents })),
    };
  });

  // Edit (pre-ship): re-prices + re-reserves. The UI warns if already exported.
  app.patch('/api/admin/orders/:id', { preHandler: requireAdmin('fulfillment', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const edit = OrderEditSchema.parse(req.body);
    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw NotFound('Order not found');
    const updated = await applyOrderEdit(prisma, order, edit, { type: 'admin', id: req.admin!.adminUserId, ip: req.ip });
    return { ok: true, wallet_charge_cents: updated.walletChargeCents, blocker: updated.blocker };
  });

  // Re-send (failsafe): clear the export stamp so the order re-enters ShipStation's
  // next export pull. (Pull model — we can't force ShipStation to fetch; this makes
  // the order grabbable again on its next auto/manual refresh.) Touches updatedAt.
  app.post('/api/admin/orders/:id/resend', { preHandler: requireAdmin('fulfillment', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw NotFound('Order not found');
    if (order.status === 'cancelled') throw BadRequest('cancelled', 'Cannot re-send a cancelled order');
    if (order.status === 'shipped' || order.status === 'delivered') {
      throw Conflict('already_shipped', 'Order already shipped');
    }
    await prisma.$transaction(async (tx) => {
      // The update itself bumps @updatedAt → re-enters the export window.
      await tx.order.update({ where: { id }, data: { exportedAt: null } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.orderResent,
        targetType: 'order',
        targetId: id,
        ip: req.ip,
      });
    });
    return { ok: true };
  });

  // Manual mark-shipped (failsafe): capture the wallet + record tracking when a
  // label was created outside ShipStation or the shipnotify never arrived. Normal
  // shipping flows through the Custom Store shipnotify endpoint.
  app.post('/api/admin/orders/:id/ship', { preHandler: requireAdmin('fulfillment', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = OrderShipSchema.parse(req.body ?? {});
    if (!body.tracking_number) throw BadRequest('tracking_required', 'Enter a tracking number to mark shipped');
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw NotFound('Order not found');
    if (order.status === 'shipped' || order.status === 'delivered') throw Conflict('already_shipped', 'Order already shipped');
    if (order.status === 'cancelled') throw BadRequest('cancelled', 'Cannot ship a cancelled order');

    // Re-check funds (covers orders placed while awaiting_funds).
    const { available } = await getWalletSummary(prisma, order.brandId);
    const reservedSelf = order.blocker === 'none' ? order.walletChargeCents : 0;
    if (available + reservedSelf < order.walletChargeCents) {
      throw BadRequest('insufficient_funds', "Brand's wallet can't cover this order — awaiting funds");
    }

    const carrier = body.carrier ?? order.shippingCarrier ?? 'USPS';
    const shipped = await prisma.$transaction(async (tx) => {
      // Conditional transition: only ship an order still in a pre-ship state, so a
      // cancel that raced in between the read above and here isn't overwritten.
      const gate = await tx.order.updateMany({
        where: { id, status: { in: ['ready_for_fulfillment', 'processing'] } },
        data: { status: 'shipped', blocker: 'none', trackingNumber: body.tracking_number, carrier, shippedAt: new Date() },
      });
      if (gate.count === 0) throw Conflict('not_shippable', 'Order can no longer be shipped — it may have been cancelled');
      const o = await tx.order.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.orderShipped,
        targetType: 'order',
        targetId: id,
        after: { source: 'manual_admin', tracking_number: body.tracking_number, carrier, captured_cents: o.walletChargeCents },
        ip: req.ip,
      });
      return o;
    });

    // Capture AFTER the ship is committed, so a cancel that won the race above is
    // never debited. captureOrder is idempotent on the order id.
    await captureOrder(prisma, shipped);
    await onOrderShipped(shipped); // WooCommerce/Wix tracking writeback seam
    return { ok: true, status: shipped.status, tracking_number: body.tracking_number, carrier };
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
