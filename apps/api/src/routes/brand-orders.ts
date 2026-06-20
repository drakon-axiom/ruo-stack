import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AUDIT_ACTIONS,
  OrderCreateSchema,
  OrderEditSchema,
  OrderQuoteSchema,
  PLANS,
  wholesaleFieldFor,
} from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireBrand } from '../middleware/guards.js';
import { effectivePlan } from '../services/subscription.js';
import { getWalletSummary } from '../services/wallet.js';
import { applyOrderEdit } from '../services/order-edit.js';
import { deriveParcel, loadShippingRules, priceShipping, resolveShippingPricing, type ParcelProduct } from '../services/shipping.js';
import { loadConfig } from '../config.js';
import { BadRequest, Conflict, NotFound } from '../errors.js';

/**
 * Brand order intake (manual-first). Orders are priced at the brand's tier
 * wholesale + flat shipping; placing one reserves funds (held). Insufficient
 * available funds → blocker awaiting_funds (Action Required). The Starter plan
 * is capped at 20 orders/month.
 */
export async function brandOrderRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  function startOfMonth(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  // ── Create a manual order ──────────────────────────────────────────────────
  app.post('/api/brand/orders', { preHandler: requireBrand }, async (req, reply) => {
    const { brandId, userId } = req.brand!;
    const body = OrderCreateSchema.parse(req.body);

    // Resolve the brand's effective tier (drives wholesale pricing + the cap).
    const sub = await prisma.subscriptionState.findUnique({
      where: { brandId },
      select: { plan: true, status: true },
    });
    const plan = effectivePlan(sub);

    // Starter plan: 20 orders / calendar month.
    const cap = PLANS[plan].capabilities.maxOrdersPerMonth;
    if (cap !== null) {
      const used = await prisma.order.count({
        where: { brandId, createdAt: { gte: startOfMonth() }, status: { not: 'cancelled' } },
      });
      if (used >= cap) {
        throw Conflict('order_cap_reached', `Your ${PLANS[plan].name} plan is limited to ${cap} orders/month — upgrade for more`);
      }
    }

    // Price the line items at the brand's tier wholesale (snapshotted).
    const wf = wholesaleFieldFor(plan);
    const productIds = body.items.map((i) => i.product_id);
    const products = await prisma.catalogProduct.findMany({
      where: { id: { in: productIds }, isPublished: true },
      select: {
        id: true,
        wholesaleStarter: true,
        wholesalePro: true,
        wholesaleVolume: true,
        weight: true,
        length: true,
        width: true,
        height: true,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = body.items.map((i) => {
      const p = byId.get(i.product_id);
      if (!p) throw BadRequest('unknown_product', `Product ${i.product_id} is not available`);
      return { productId: i.product_id, qty: i.qty, unitWholesaleCents: p[wf] };
    });
    const wholesaleTotal = lines.reduce((s, l) => s + l.unitWholesaleCents * l.qty, 0);

    // Shipping: flat for Starter, live (re-rated server-side) for Pro/Volume.
    const parcelItems: ParcelProduct[] = body.items.map((i) => {
      const p = byId.get(i.product_id)!;
      return { qty: i.qty, weight: p.weight, length: p.length, width: p.width, height: p.height };
    });
    const pricing = await resolveShippingPricing(prisma, brandId);
    const rules = await loadShippingRules(prisma);
    const parcel = deriveParcel(parcelItems, rules.boxes, loadConfig().SHIPPING_DIM_DIVISOR);
    const shipQuote = await priceShipping(plan, parcel, { toZip: body.zip, toState: body.state }, body.service_code, pricing, rules.mappings);
    const shipping = shipQuote.chosen.amountCents; // brand cost = carrier + pick-&-pack
    const walletCharge = wholesaleTotal + shipping;

    // Funds check against available = balance − held (existing open orders).
    const { available } = await getWalletSummary(prisma, brandId);
    const blocker = available >= walletCharge ? 'none' : 'awaiting_funds';

    const order = await prisma.$transaction(async (tx) => {
      const o = await tx.order.create({
        data: {
          brandId,
          source: 'manual',
          status: 'ready_for_fulfillment',
          blocker,
          recipientName: body.recipient_name,
          recipientEmail: body.recipient_email || null,
          recipientPhone: body.recipient_phone || null,
          address1: body.address1,
          address2: body.address2 || null,
          city: body.city,
          state: body.state,
          zip: body.zip,
          country: body.country,
          wholesaleTotalCents: wholesaleTotal,
          shippingTotalCents: shipping,
          walletChargeCents: walletCharge,
          shippingServiceCode: shipQuote.chosen.serviceCode,
          shippingCarrier: shipQuote.chosen.carrier,
          items: { create: lines },
        },
        include: { items: true },
      });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId: userId,
        action: AUDIT_ACTIONS.orderCreated,
        targetType: 'order',
        targetId: o.id,
        after: { wallet_charge_cents: walletCharge, blocker, items: lines.length },
        ip: req.ip,
      });
      return o;
    });

    return reply.code(201).send(serializeOrder(order));
  });

  // ── Rate preview (items + destination → shipping options) ─────────────────
  app.post('/api/brand/orders/quote', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const body = OrderQuoteSchema.parse(req.body);
    const sub = await prisma.subscriptionState.findUnique({ where: { brandId }, select: { plan: true, status: true } });
    const plan = effectivePlan(sub);
    const wf = wholesaleFieldFor(plan);
    const products = await prisma.catalogProduct.findMany({
      where: { id: { in: body.items.map((i) => i.product_id) }, isPublished: true },
      select: { id: true, wholesaleStarter: true, wholesalePro: true, wholesaleVolume: true, weight: true, length: true, width: true, height: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    let wholesale = 0;
    const parcelItems: ParcelProduct[] = body.items.map((i) => {
      const p = byId.get(i.product_id);
      if (!p) throw BadRequest('unknown_product', `Product ${i.product_id} is not available`);
      wholesale += p[wf] * i.qty;
      return { qty: i.qty, weight: p.weight, length: p.length, width: p.width, height: p.height };
    });
    const pricing = await resolveShippingPricing(prisma, brandId);
    const rules = await loadShippingRules(prisma);
    const parcel = deriveParcel(parcelItems, rules.boxes, loadConfig().SHIPPING_DIM_DIVISOR);
    const q = await priceShipping(plan, parcel, { toZip: body.zip, toState: body.state }, undefined, pricing, rules.mappings);
    return {
      plan,
      wholesale_cents: wholesale,
      shipping_source: q.source,
      shipping_options: q.options.map((o) => ({
        carrier: o.carrier,
        service: o.service,
        service_code: o.serviceCode,
        amount_cents: o.amountCents, // brand cost (carrier + pick-&-pack) — what the wallet pays
        est_days: o.estDays ?? null,
      })),
      recommended_service_code: q.chosen.serviceCode,
      recommended_shipping_cents: q.chosen.amountCents,
      total_cents: wholesale + q.chosen.amountCents,
    };
  });

  // ── List / detail ──────────────────────────────────────────────────────────
  app.get('/api/brand/orders', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const q = z
      .object({
        status: z.enum(['ready_for_fulfillment', 'processing', 'shipped', 'delivered', 'cancelled']).optional(),
        blocked: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const orders = await prisma.order.findMany({
      where: {
        brandId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.blocked ? { blocker: { not: 'none' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    return { orders: orders.map(serializeOrder) };
  });

  app.get('/api/brand/orders/:id', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const order = await prisma.order.findFirst({ where: { id, brandId }, include: { items: true } });
    if (!order) throw NotFound('Order not found');
    return serializeOrder(order);
  });

  // ── Edit (pre-ship) — re-prices + re-reserves; warns the UI if exported ────
  app.patch('/api/brand/orders/:id', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const edit = OrderEditSchema.parse(req.body);
    const order = await prisma.order.findFirst({ where: { id, brandId }, include: { items: true } });
    if (!order) throw NotFound('Order not found');
    const updated = await applyOrderEdit(prisma, order, edit, { type: 'brand', id: userId, ip: req.ip });
    return serializeOrder(updated);
  });

  // ── Cancel (pre-ship only) — releases the reservation ─────────────────────
  app.post('/api/brand/orders/:id/cancel', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const order = await prisma.order.findFirst({ where: { id, brandId } });
    if (!order) throw NotFound('Order not found');
    if (order.status === 'shipped' || order.status === 'delivered') {
      throw BadRequest('already_shipped', 'A shipped order cannot be cancelled');
    }
    if (order.status === 'cancelled') return serializeOrder({ ...order, items: [] });

    const updated = await prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id },
        data: { status: 'cancelled', blocker: 'none' },
        include: { items: true },
      });
      await writeAudit(tx, {
        actorType: 'brand',
        actorId: userId,
        action: AUDIT_ACTIONS.orderCancelled,
        targetType: 'order',
        targetId: id,
        ip: req.ip,
      });
      return o;
    });
    return serializeOrder(updated);
  });
}

type OrderRow = {
  id: string;
  status: string;
  blocker: string;
  source: string;
  recipientName: string;
  recipientEmail: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  wholesaleTotalCents: number;
  shippingTotalCents: number;
  walletChargeCents: number;
  shippingServiceCode: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  exportedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  items?: { id: string; productId: string; qty: number; unitWholesaleCents: number }[];
};

function serializeOrder(o: OrderRow) {
  return {
    id: o.id,
    status: o.status,
    blocker: o.blocker,
    source: o.source,
    recipient: {
      name: o.recipientName,
      email: o.recipientEmail,
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
    tracking_number: o.trackingNumber,
    carrier: o.carrier,
    exported_at: o.exportedAt,
    shipped_at: o.shippedAt,
    delivered_at: o.deliveredAt,
    created_at: o.createdAt,
    items: (o.items ?? []).map((i) => ({
      id: i.id,
      product_id: i.productId,
      qty: i.qty,
      unit_wholesale_cents: i.unitWholesaleCents,
    })),
  };
}
