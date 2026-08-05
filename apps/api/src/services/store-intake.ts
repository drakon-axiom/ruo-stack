import type { BrandStoreConnection, PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, wholesaleFieldFor } from '@ruostack/shared';
import { writeAudit } from '../audit.js';
import { effectivePlan } from './subscription.js';
import { getWalletSummary } from './wallet.js';
import { deriveParcel, loadShippingRules, orderBoxFields, priceShipping, resolveShippingPricing, type ParcelProduct } from './shipping.js';
import { findRateQuote } from './rate-quote.js';
import { resolveSkus } from './sku-resolver.js';
import { Prisma } from '@ruostack/db';
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
  shipping_lines?: { method_id?: string; method_title?: string }[];
  shipping?: WooAddress;
  billing?: WooAddress;
}

interface LockedBox {
  boxId: string | null;
  boxName: string | null;
  boxLengthIn: number | null;
  boxWidthIn: number | null;
  boxHeightIn: number | null;
  billableWeightOz: number | null;
}

/** The service the customer picked at checkout — our plugin sets method_id `ruostack:<code>`. */
function chosenServiceFromWoo(woo: WooOrder): string | null {
  const m = woo.shipping_lines?.[0]?.method_id ?? '';
  return m.startsWith('ruostack:') ? m.slice('ruostack:'.length) : null;
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

  const sub = await prisma.subscriptionState.findUnique({ where: { brandId }, select: { plan: true, status: true, currentPeriodEnd: true } });
  const plan = effectivePlan(sub);
  const wf = wholesaleFieldFor(plan);

  const lineItems = woo.line_items ?? [];
  const sourceItems = lineItems.map((li) => ({ sku: (li.sku ?? '').trim(), qty: Math.max(1, li.quantity ?? 1) })).filter((i) => i.sku);
  // Resolve by canonical SKU, then per-brand alias; unresolved → No-Match.
  const resolved = await resolveSkus(prisma, brandId, sourceItems.map((i) => i.sku));

  const lines: { productId: string; qty: number; unitWholesaleCents: number }[] = [];
  const parcelItems: ParcelProduct[] = [];
  const unmatchedSkus: string[] = [];
  for (const it of sourceItems) {
    const p = resolved.get(it.sku) ?? null;
    if (!p) {
      unmatchedSkus.push(it.sku);
      continue;
    }
    lines.push({ productId: p.id, qty: it.qty, unitWholesaleCents: p[wf] });
    parcelItems.push({ qty: it.qty, weight: p.weight, length: p.length, width: p.width, height: p.height });
  }
  const unmatched = unmatchedSkus.length;
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

  // Shipping cost to the brand. Prefer the EXACT checkout quote (§9): reserve what
  // the customer was quoted + lock that box/service. Fall back to re-rating when no
  // live quote exists (manual import, expired quote, non-RUOStack shipping method).
  let shipping = 0;
  let boxFields: LockedBox | null = null;
  let serviceCode: string | null = null;
  let carrier: string | null = null;
  let rateSource: string | null = null;
  let fromQuote = false;
  if (lines.length > 0 && hasAddress) {
    const chosen = chosenServiceFromWoo(woo);
    const quote = chosen ? await findRateQuote(prisma, brandId, sourceItems, { zip, state }, chosen) : null;
    if (quote) {
      shipping = quote.brandCostCents;
      serviceCode = quote.serviceCode;
      rateSource = 'quote';
      fromQuote = true;
      const box = quote.boxId ? await prisma.box.findUnique({ where: { id: quote.boxId } }) : null;
      boxFields = { boxId: quote.boxId, boxName: box?.name ?? null, boxLengthIn: box?.innerLengthIn ?? null, boxWidthIn: box?.innerWidthIn ?? null, boxHeightIn: box?.innerHeightIn ?? null, billableWeightOz: quote.billableWeightOz };
    } else {
      const pricing = await resolveShippingPricing(prisma, brandId);
      const rules = await loadShippingRules(prisma);
      const parcel = deriveParcel(parcelItems, rules.boxes, loadConfig().SHIPPING_DIM_DIVISOR);
      boxFields = orderBoxFields(parcel);
      const q = await priceShipping(plan, parcel, { toZip: zip, toState: state }, chosen ?? undefined, pricing, rules.mappings);
      shipping = q.chosen.amountCents; // brand cost = carrier + pick-&-pack
      serviceCode = q.chosen.serviceCode;
      carrier = q.chosen.carrier;
      rateSource = q.source;
    }
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

  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
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
          sourceItems: sourceItems as unknown as Prisma.InputJsonValue,
          unmatchedSkus,
          ...(serviceCode ? { shippingServiceCode: serviceCode } : {}),
          ...(carrier ? { shippingCarrier: carrier } : {}),
          ...(rateSource ? { rateSource } : {}),
          ...(boxFields ?? {}),
          ...(lines.length ? { items: { create: lines } } : {}),
        },
      });
      await writeAudit(tx, {
        actorType: 'system',
        actorId: null,
        action: AUDIT_ACTIONS.storeOrderImported,
        targetType: 'order',
        targetId: o.id,
        after: { source: 'woocommerce', external_order_id: externalOrderId, blocker, matched: lines.length, unmatched, wallet_charge_cents: walletCharge, from_quote: fromQuote },
        ip: null,
      });
      return o;
    });
  } catch (err) {
    // Lost the idempotency race: a concurrent order.created/order.updated delivery
    // for the same store order inserted first. The unique index on
    // (brand_id, source, external_order_id) makes this a no-op, not a duplicate.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.order.findFirst({ where: { brandId, source: 'woocommerce', externalOrderId } });
      if (existing) return { created: false, orderId: existing.id, blocker: existing.blocker, matched: 0, unmatched: 0 };
    }
    throw err;
  }

  await prisma.brandStoreConnection.update({ where: { id: connection.id }, data: { lastOrderAt: new Date(), status: 'active', lastError: null } });
  return { created: true, orderId: order.id, blocker, matched: lines.length, unmatched };
}
