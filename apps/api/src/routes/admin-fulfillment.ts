import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, OrderShipSchema } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { loadConfig } from '../config.js';
import { writeAudit } from '../audit.js';
import { requireAdmin } from '../middleware/guards.js';
import { captureOrder, getWalletSummary } from '../services/wallet.js';
import { computeParcel } from '../services/shipping.js';
import { getLabelsAdapter } from '../services/rates/index.js';
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
        shipping_service_code: o.shippingServiceCode,
        carrier_rated: !!o.shippingServiceCode && o.shippingServiceCode !== 'flat',
        tracking_number: o.trackingNumber,
        carrier: o.carrier,
        label_url: o.labelUrl,
        created_at: o.createdAt,
      })),
    };
  });

  // Ship — buys a ShipStation label when the order is carrier-rated (else takes a
  // manual tracking number), captures the wallet, fires the writeback seam.
  app.post('/api/admin/orders/:id/ship', { preHandler: requireAdmin('fulfillment', 'write') }, async (req) => {
    const cfg = loadConfig();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = OrderShipSchema.parse(req.body ?? {});
    const order = await prisma.order.findUnique({ where: { id }, include: { items: { include: { product: true } } } });
    if (!order) throw NotFound('Order not found');
    if (order.status === 'shipped' || order.status === 'delivered') throw Conflict('already_shipped', 'Order already shipped');
    if (order.status === 'cancelled') throw BadRequest('cancelled', 'Cannot ship a cancelled order');

    // Re-check funds (covers orders placed while awaiting_funds).
    const { available } = await getWalletSummary(prisma, order.brandId);
    const reservedSelf = order.blocker === 'none' ? order.walletChargeCents : 0;
    if (available + reservedSelf < order.walletChargeCents) {
      throw BadRequest('insufficient_funds', "Brand's wallet can't cover this order — awaiting funds");
    }

    // Resolve tracking/label: buy a ShipStation label when the order is carrier-
    // rated and no manual tracking was supplied; otherwise take manual tracking.
    const labels = getLabelsAdapter();
    const canBuy = !!labels && !!order.shippingServiceCode && order.shippingServiceCode !== 'flat' && !body.tracking_number;

    let trackingNumber: string;
    let carrier: string;
    let labelUrl: string | null = null;
    let labelCostCents: number | null = null;

    if (canBuy) {
      const parcel = computeParcel(
        order.items.map((it) => ({ qty: it.qty, weight: it.product.weight, length: it.product.length, width: it.product.width, height: it.product.height })),
      );
      let label;
      try {
        label = await labels!.buyLabel({
        serviceCode: order.shippingServiceCode!,
        testLabel: cfg.SHIPSTATION_TEST_LABELS,
        shipFrom: {
          name: cfg.WAREHOUSE_NAME,
          phone: cfg.WAREHOUSE_PHONE,
          addressLine1: cfg.WAREHOUSE_FROM_STREET,
          cityLocality: cfg.WAREHOUSE_FROM_CITY,
          stateProvince: cfg.WAREHOUSE_FROM_STATE,
          postalCode: cfg.WAREHOUSE_FROM_ZIP,
          countryCode: 'US',
        },
        shipTo: {
          name: order.recipientName,
          phone: order.recipientPhone ?? undefined,
          addressLine1: order.address1,
          addressLine2: order.address2 ?? undefined,
          cityLocality: order.city,
          stateProvince: order.state,
          postalCode: order.zip,
          countryCode: order.country,
          residential: true,
        },
          weightOz: parcel.weightOz,
          lengthIn: parcel.lengthIn || undefined,
          widthIn: parcel.widthIn || undefined,
          heightIn: parcel.heightIn || undefined,
        });
      } catch (e) {
        // Surface the carrier's reason instead of a generic 500.
        throw BadRequest('label_failed', e instanceof Error ? e.message.slice(0, 240) : 'Label purchase failed');
      }
      trackingNumber = label.trackingNumber;
      carrier = label.carrier;
      labelUrl = label.labelUrl;
      labelCostCents = label.costCents;
    } else {
      if (!body.tracking_number) throw BadRequest('tracking_required', 'Enter a tracking number (no label could be bought)');
      trackingNumber = body.tracking_number;
      carrier = body.carrier ?? order.shippingCarrier ?? 'USPS';
    }

    // Capture the wallet, then mark shipped with the label/tracking.
    await captureOrder(prisma, order);
    const shipped = await prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id },
        data: { status: 'shipped', blocker: 'none', trackingNumber, carrier, labelUrl, labelCostCents, shippedAt: new Date() },
      });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.orderShipped,
        targetType: 'order',
        targetId: id,
        after: { tracking_number: trackingNumber, carrier, label_bought: canBuy, label_cost_cents: labelCostCents, captured_cents: o.walletChargeCents },
        ip: req.ip,
      });
      return o;
    });

    await onOrderShipped(shipped); // TODO(Phase 1.5): store tracking writeback
    return { ok: true, status: shipped.status, tracking_number: trackingNumber, carrier, label_url: labelUrl };
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
