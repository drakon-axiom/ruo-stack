import type { BrandStoreConnection, PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, wholesaleFieldFor } from '@ruostack/shared';
import { writeAudit } from '../audit.js';
import { effectivePlan } from './subscription.js';
import { getWalletSummary } from './wallet.js';
import { deriveParcel, loadShippingRules, priceShipping, resolveShippingPricing, type ParcelProduct } from './shipping.js';
import { loadConfig } from '../config.js';

interface WooLineItem {
  sku?: string;
  quantity?: number;
  name?: string;
}
interface WooAddress {
  first_name?: string;
  last_name?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  phone?: string;
  email?: string;
}
export interface WooOrder {
  id: number | string;
  number?: string;
  line_items?: WooLineItem[];
  shipping?: WooAddress;
  billing?: WooAddress;
}

export interface ImportResult {
  created: boolean;
  orderId: string;
  blocker: string;
  matched: number;
  unmatched: number;
}

/**
 * Import a WooCommerce order into RUOStack: map line-item SKUs to the catalog by
 * exact canonical SKU, price wholesale at the brand's tier, re-rate shipping, and
 * reserve funds (held). Blocker precedence: missing address > unmatched SKU >
 * insufficient funds. Idempotent on (brand, source, external order id) so webhook
 * retries don't duplicate the order.
 */
export async function importWooOrder(
  prisma: PrismaClient,
  connection: BrandStoreConnection,
  woo: WooOrder,
): Promise<ImportResult> {
  const brandId = connection.brandId;
  const externalOrderId = String(woo.id);

  const dupe = await prisma.order.findFirst({ where: { brandId, source: 'woocommerce', externalOrderId } });
  if (dupe) {
    return { created: false, orderId: dupe.id, blocker: dupe.blocker, matched: 0, unmatched: 0 };
  }

  const sub = await prisma.subscriptionState.findUnique({ where: { brandId }, select: { plan: true, status: true } });
  const plan = effectivePlan(sub);
  const wf = wholesaleFieldFor(plan);

  const lineItems = woo.line_items ?? [];
  const skus = lineItems.map((li) => (li.sku ?? '').trim()).filter(Boolean);
  const products = await prisma.catalogProduct.findMany({
    where: { canonicalSku: { in: skus }, isPublished: true },
    select: { id: true, canonicalSku: true, wholesaleStarter: true, wholesalePro: true, wholesaleVolume: true, weight: true, length: true, width: true, height: true },
  });
  const bySku = new Map(products.map((p) => [p.canonicalSku, p]));

  const lines: { productId: string; qty: number; unitWholesaleCents: number }[] = [];
  const parcelItems: ParcelProduct[] = [];
  let unmatched = 0;
  for (const li of lineItems) {
    const sku = (li.sku ?? '').trim();
    const p = sku ? bySku.get(sku) : undefined;
    if (!p) {
      unmatched++;
      continue;
    }
    const qty = Math.max(1, li.quantity ?? 1);
    lines.push({ productId: p.id, qty, unitWholesaleCents: p[wf] });
    parcelItems.push({ qty, weight: p.weight, length: p.length, width: p.width, height: p.height });
  }
  const wholesaleTotal = lines.reduce((s, l) => s + l.unitWholesaleCents * l.qty, 0);

  const ship = woo.shipping ?? {};
  const bill = woo.billing ?? {};
  const recipientName = `${ship.first_name ?? bill.first_name ?? ''} ${ship.last_name ?? bill.last_name ?? ''}`.trim() || 'Unknown';
  const address1 = (ship.address_1 ?? '').trim();
  const city = (ship.city ?? '').trim();
  const state = (ship.state ?? '').trim();
  const zip = (ship.postcode ?? '').trim();
  const country = ((ship.country ?? 'US').trim() || 'US').slice(0, 2);
  const hasAddress = !!(address1 && city && state && zip);

  // Shipping cost to the brand: re-rate server-side (flat for Starter; live for Pro/Volume).
  let shipping = 0;
  if (lines.length > 0 && hasAddress) {
    const pricing = await resolveShippingPricing(prisma, brandId);
    const rules = await loadShippingRules(prisma);
    const parcel = deriveParcel(parcelItems, rules.boxes, loadConfig().SHIPPING_DIM_DIVISOR);
    const q = await priceShipping(plan, parcel, { toZip: zip, toState: state }, undefined, pricing, rules.mappings);
    shipping = q.chosen.amountCents; // brand cost = carrier + pick-&-pack
  }
  const walletCharge = wholesaleTotal + shipping;

  // Blocker precedence: can't ship without an address; then SKU mapping; then funds.
  let blocker: 'none' | 'needs_address' | 'needs_mapping' | 'awaiting_funds' = 'none';
  if (!hasAddress) blocker = 'needs_address';
  else if (unmatched > 0 || lines.length === 0) blocker = 'needs_mapping';
  else {
    const { available } = await getWalletSummary(prisma, brandId);
    if (available < walletCharge) blocker = 'awaiting_funds';
  }

  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: {
        brandId,
        source: 'woocommerce',
        status: 'ready_for_fulfillment',
        blocker,
        externalOrderId,
        recipientName,
        recipientEmail: bill.email ?? ship.email ?? null,
        recipientPhone: ship.phone ?? bill.phone ?? null,
        address1,
        address2: ship.address_2?.trim() || null,
        city,
        state,
        zip,
        country,
        wholesaleTotalCents: wholesaleTotal,
        shippingTotalCents: shipping,
        walletChargeCents: walletCharge,
        ...(lines.length ? { items: { create: lines } } : {}),
      },
    });
    await writeAudit(tx, {
      actorType: 'system',
      actorId: null,
      action: AUDIT_ACTIONS.storeOrderImported,
      targetType: 'order',
      targetId: o.id,
      after: { source: 'woocommerce', external_order_id: externalOrderId, blocker, matched: lines.length, unmatched, wallet_charge_cents: walletCharge },
      ip: null,
    });
    return o;
  });

  await prisma.brandStoreConnection.update({ where: { id: connection.id }, data: { lastOrderAt: new Date(), status: 'active', lastError: null } });
  return { created: true, orderId: order.id, blocker, matched: lines.length, unmatched };
}
