import type { Prisma, PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, type OrderEdit, wholesaleFieldFor } from '@ruostack/shared';
import { writeAudit } from '../audit.js';
import { effectivePlan } from './subscription.js';
import { getWalletSummary } from './wallet.js';
import { computeParcel, priceShipping, resolveShippingPricing, type ParcelProduct } from './shipping.js';
import { BadRequest, Conflict } from '../errors.js';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

interface Actor {
  type: 'admin' | 'brand';
  id: string;
  ip?: string | null;
}

/**
 * Apply a pre-ship edit to an order (shared by the brand + admin routes): re-price
 * the line items at the brand's tier wholesale, re-quote shipping, recompute the
 * wallet charge, and re-evaluate the funds reservation. Editing a shipped/cancelled
 * order is rejected. The order's OWN current reservation is excluded from the
 * available-funds check so an unchanged-but-re-saved order doesn't false-trip
 * awaiting_funds.
 */
export async function applyOrderEdit(
  prisma: PrismaClient,
  order: OrderWithItems,
  edit: OrderEdit,
  actor: Actor,
): Promise<OrderWithItems> {
  if (order.status === 'shipped' || order.status === 'delivered') {
    throw Conflict('already_shipped', 'A shipped order can no longer be edited');
  }
  if (order.status === 'cancelled') throw BadRequest('cancelled', 'A cancelled order cannot be edited');

  const sub = await prisma.subscriptionState.findUnique({
    where: { brandId: order.brandId },
    select: { plan: true, status: true },
  });
  const plan = effectivePlan(sub);
  const wf = wholesaleFieldFor(plan);

  // Items: edit.items REPLACES; otherwise keep the existing lines.
  const desired = edit.items ?? order.items.map((i) => ({ product_id: i.productId, qty: i.qty }));
  const products = await prisma.catalogProduct.findMany({
    where: { id: { in: desired.map((i) => i.product_id) }, isPublished: true },
    select: { id: true, wholesaleStarter: true, wholesalePro: true, wholesaleVolume: true, weight: true, length: true, width: true, height: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = desired.map((i) => {
    const p = byId.get(i.product_id);
    if (!p) throw BadRequest('unknown_product', `Product ${i.product_id} is not available`);
    return { productId: i.product_id, qty: i.qty, unitWholesaleCents: p[wf] };
  });
  const wholesaleTotal = lines.reduce((s, l) => s + l.unitWholesaleCents * l.qty, 0);

  // Recipient: merge edit over existing.
  const recipient = {
    recipientName: edit.recipient_name ?? order.recipientName,
    recipientEmail: edit.recipient_email !== undefined ? edit.recipient_email || null : order.recipientEmail,
    recipientPhone: edit.recipient_phone !== undefined ? edit.recipient_phone || null : order.recipientPhone,
    address1: edit.address1 ?? order.address1,
    address2: edit.address2 !== undefined ? edit.address2 || null : order.address2,
    city: edit.city ?? order.city,
    state: edit.state ?? order.state,
    zip: edit.zip ?? order.zip,
    country: edit.country ?? order.country,
  };

  // Re-quote shipping for the (possibly new) parcel + destination + service.
  const parcelItems: ParcelProduct[] = desired.map((i) => {
    const p = byId.get(i.product_id)!;
    return { qty: i.qty, weight: p.weight, length: p.length, width: p.width, height: p.height };
  });
  const serviceCode = edit.service_code ?? order.shippingServiceCode ?? undefined;
  const pricing = await resolveShippingPricing(prisma, order.brandId);
  const shipQuote = await priceShipping(plan, computeParcel(parcelItems), { toZip: recipient.zip, toState: recipient.state }, serviceCode, pricing);
  const shipping = shipQuote.chosen.amountCents; // brand cost = carrier + pick-&-pack
  const walletCharge = wholesaleTotal + shipping;

  // Funds: exclude this order's current reservation from held before comparing.
  const { available } = await getWalletSummary(prisma, order.brandId);
  const reservedSelf = order.blocker === 'none' ? order.walletChargeCents : 0;
  const blocker = available + reservedSelf >= walletCharge ? 'none' : 'awaiting_funds';

  return prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        ...recipient,
        wholesaleTotalCents: wholesaleTotal,
        shippingTotalCents: shipping,
        walletChargeCents: walletCharge,
        shippingServiceCode: shipQuote.chosen.serviceCode,
        shippingCarrier: shipQuote.chosen.carrier,
        blocker,
        items: { create: lines },
      },
      include: { items: true },
    });
    await writeAudit(tx, {
      actorType: actor.type,
      actorId: actor.id,
      action: AUDIT_ACTIONS.orderUpdated,
      targetType: 'order',
      targetId: order.id,
      before: { wallet_charge_cents: order.walletChargeCents, items: order.items.length },
      after: { wallet_charge_cents: walletCharge, items: lines.length, blocker, already_exported: !!order.exportedAt },
      ip: actor.ip ?? null,
    });
    return updated;
  });
}
