import { randomUUID } from 'node:crypto';
import { lockOrder, releaseLotReservations } from './lot-inventory.ts';
import type { Prisma, PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, type OrderEdit, wholesaleFieldFor } from '@ruostack/shared';
import { writeAudit } from '../audit.ts';
import { effectivePlan } from './subscription.ts';
import { getWalletSummary, lockBrandWallet } from './wallet.ts';
import { deriveParcel, loadShippingRules, orderBoxFields, priceShipping, resolveShippingPricing, type ParcelProduct } from './shipping.ts';
import { loadConfig } from '../config.ts';
import { BadRequest, Conflict } from '../errors.ts';

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
  sourceLines?: {product_id:string;qty:number;wooLineId:string|null}[],
): Promise<OrderWithItems> {
  if (order.status === 'shipped' || order.status === 'delivered') {
    throw Conflict('already_shipped', 'A shipped order can no longer be edited');
  }
  if (order.status === 'cancelled') throw BadRequest('cancelled', 'A cancelled order cannot be edited');

  const sub = await prisma.subscriptionState.findUnique({
    where: { brandId: order.brandId },
    select: { plan: true, status: true, currentPeriodEnd: true },
  });
  const plan = effectivePlan(sub);
  const wf = wholesaleFieldFor(plan);

  // Items: edit.items REPLACES; otherwise keep the existing lines.
  const desired = sourceLines ?? edit.items ?? order.items.map((i) => ({ product_id: i.productId, qty: i.qty, order_item_id:i.id }));
  const usedSourceIds=new Set<string>();
  const products = await prisma.catalogProduct.findMany({
    where: { id: { in: desired.map((i) => i.product_id) }, isPublished: true },
    select: { id: true, wholesaleStarter: true, wholesalePro: true, wholesaleVolume: true, weight: true, length: true, width: true, height: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = desired.map((i) => {
    const p = byId.get(i.product_id);
    if (!p) throw BadRequest('unknown_product', `Product ${i.product_id} is not available`);
    const id='order_item_id' in i?i.order_item_id:undefined;
    const candidates=order.items.filter(old=>old.productId===i.product_id);
    const original=id?order.items.find(old=>old.id===id):candidates.length===1?candidates[0]:undefined;
    if(id&&(!original||original.productId!==i.product_id))throw BadRequest('line_identity','Order item identity does not match this product');
    if(original){if(usedSourceIds.has(original.id))throw BadRequest('duplicate_line','Order line identity reused');usedSourceIds.add(original.id);}
    if(order.source==='woocommerce'&&!sourceLines&&!original&&candidates.length>1)throw BadRequest('line_identity','Choose an explicit order item ID for duplicate SKU lines');
    const wooLineId='wooLineId' in i?i.wooLineId:original?.wooLineId??null;
    return { productId: i.product_id, qty: i.qty, unitWholesaleCents: p[wf], wooLineId };
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
  const rules = await loadShippingRules(prisma);
  const parcel = deriveParcel(parcelItems, rules.boxes, loadConfig().SHIPPING_DIM_DIVISOR);
  const shipQuote = await priceShipping(prisma, plan, parcel, { toZip: recipient.zip, toState: recipient.state }, serviceCode, pricing, rules.mappings);
  const shipping = shipQuote.chosen.amountCents; // brand cost = carrier + pick-&-pack
  const walletCharge = wholesaleTotal + shipping;

  // Whether the (post-edit, merged) address is complete.
  const hasAddress = !!(
    recipient.address1.trim() && recipient.city.trim() && recipient.state.trim() && recipient.zip.trim()
  );

  return prisma.$transaction(async (tx) => {
    await lockBrandWallet(tx, order.brandId);
    const current = await lockOrder(tx, order.id);
    if (!['ready_for_fulfillment','processing'].includes(current.status)) throw BadRequest('not_editable','Order can no longer be edited');
    // Blocker precedence (same as intake): address > unmapped SKUs > funds. An
    // edit must NOT clear a needs_address / needs_mapping order just because funds
    // now cover it — unmatchedSkus persist on the order until it's remapped, and
    // the funds decision is made under the lock so it can't race another reserve.
    let blocker: 'none' | 'needs_address' | 'needs_mapping' | 'awaiting_funds';
    if (!hasAddress) {
      blocker = 'needs_address';
    } else if (order.unmatchedSkus.length > 0) {
      blocker = 'needs_mapping';
    } else {
      const { available } = await getWalletSummary(tx, order.brandId);
      const reservedSelf = current.blocker === 'none' ? current.walletChargeCents : 0;
      blocker = available + reservedSelf >= walletCharge ? 'none' : 'awaiting_funds';
    }

    await releaseLotReservations(tx, order.id, actor.id ?? 'system', `edit:${order.id}:${randomUUID()}`);
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
        rateSource: shipQuote.source,
        ...orderBoxFields(parcel),
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
