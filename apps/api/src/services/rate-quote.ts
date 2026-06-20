import { createHash } from 'node:crypto';
import type { PrismaClient } from '@ruostack/db';
import type { PricedRateOption, ShippingPricing } from '@ruostack/shared';
import { loadConfig } from '../config.js';
import type { DerivedParcel } from './fulfillment-rules.js';

/**
 * RateQuote persistence (§9 quote-driven reserve). The rate proxy persists every
 * offered option for a cart at checkout; when the order imports we reserve the
 * EXACT quoted shipping (brand cost = carrier + pick-&-pack) and lock the box +
 * billable weight from the matching quote, rather than re-rating. Matched by a
 * stable cart_hash (sorted SKU:qty + destination) + the chosen service.
 */
export interface CartItem {
  sku: string;
  qty: number;
}

/** Deterministic, order-independent hash of the cart + destination. */
export function cartHash(items: CartItem[], dest: { zip: string; state: string }): string {
  const norm = items.map((i) => `${i.sku.trim().toLowerCase()}:${i.qty}`).sort().join(',');
  return createHash('sha256').update(`${norm}|${dest.zip.trim()}|${dest.state.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

export async function persistRateQuotes(
  db: PrismaClient,
  args: {
    brandId: string;
    items: CartItem[];
    dest: { zip: string; state: string };
    parcel: DerivedParcel;
    pricing: ShippingPricing;
    options: PricedRateOption[];
  },
): Promise<void> {
  const hash = cartHash(args.items, args.dest);
  const expiresAt = new Date(Date.now() + loadConfig().RATE_QUOTE_TTL_SECONDS * 1000);
  // A fresh quote for the same cart supersedes the prior one.
  await db.rateQuote.deleteMany({ where: { brandId: args.brandId, cartHash: hash } });
  if (args.options.length === 0) return;
  await db.rateQuote.createMany({
    data: args.options.map((o) => ({
      brandId: args.brandId,
      cartHash: hash,
      destZip: args.dest.zip,
      destState: args.dest.state,
      serviceCode: o.serviceCode,
      carrierCostCents: o.carrierCents,
      pickpackCents: args.pricing.pickpackCents,
      brandMarkupCents: args.pricing.markupCents,
      customerPriceCents: o.customerCents,
      boxId: args.parcel.boxId,
      billableWeightOz: args.parcel.weightOz,
      expiresAt,
    })),
  });
}

export interface QuotedShipping {
  brandCostCents: number; // carrier + pick-&-pack — what the wallet reserves
  serviceCode: string;
  boxId: string | null;
  billableWeightOz: number;
}

/** Look up a still-valid quote for this cart + chosen service. Null if none/expired. */
export async function findRateQuote(
  db: PrismaClient,
  brandId: string,
  items: CartItem[],
  dest: { zip: string; state: string },
  serviceCode: string,
): Promise<QuotedShipping | null> {
  const hash = cartHash(items, dest);
  const q = await db.rateQuote.findFirst({
    where: { brandId, cartHash: hash, serviceCode, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!q) return null;
  return { brandCostCents: q.carrierCostCents + q.pickpackCents, serviceCode: q.serviceCode, boxId: q.boxId, billableWeightOz: q.billableWeightOz };
}
