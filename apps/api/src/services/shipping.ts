import type { PrismaClient } from '@ruostack/db';
import {
  FLAT_FALLBACK,
  PLANS,
  priceOption,
  type PlanKey,
  type PricedRateOption,
  type ShippingPricing,
} from '@ruostack/shared';
import { loadConfig } from '../config.js';
import { quoteRates } from './rates/index.js';

// Fallbacks when a product has no weight/dims set (set real values in Catalog Manager).
export const DEFAULT_ITEM_WEIGHT_OZ = 4;
const DEFAULT_BOX = { length: 6, width: 4, height: 2 };

export interface ParcelProduct {
  qty: number;
  weight: number | null; // ounces
  length: number | null;
  width: number | null;
  height: number | null;
}

/** Sum item weights (oz); use the largest single-item dims (rough box). */
export function computeParcel(items: ParcelProduct[]): {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
} {
  let weightOz = 0;
  let lengthIn = DEFAULT_BOX.length;
  let widthIn = DEFAULT_BOX.width;
  let heightIn = DEFAULT_BOX.height;
  for (const it of items) {
    weightOz += it.qty * (it.weight ?? DEFAULT_ITEM_WEIGHT_OZ);
    lengthIn = Math.max(lengthIn, it.length ?? 0);
    widthIn = Math.max(widthIn, it.width ?? 0);
    heightIn = Math.max(heightIn, it.height ?? 0);
  }
  return { weightOz: Math.max(1, weightOz), lengthIn, widthIn, heightIn };
}

export interface ShippingQuote {
  source: string; // 'flat' | 'computed' | 'shipstation' | 'fallback'
  options: PricedRateOption[];
  chosen: PricedRateOption;
}

/**
 * Resolve a brand's shipping pricing: pick-&-pack fee (per-brand override ?? global
 * default) + the brand's markup. Both feed the pricing model in priceShipping.
 */
export async function resolveShippingPricing(db: PrismaClient, brandId: string): Promise<ShippingPricing> {
  const cfg = await db.brandShippingConfig.findUnique({ where: { brandId }, select: { pickpackFeeOverrideCents: true, markupCents: true } });
  return {
    pickpackCents: cfg?.pickpackFeeOverrideCents ?? loadConfig().SHIPPING_PICKPACK_FEE_CENTS,
    markupCents: cfg?.markupCents ?? 0,
  };
}

/**
 * Price shipping for a plan + parcel + destination. Starter → flat $12.99; Pro/
 * Volume → live rates with the pick-&-pack fee applied (the chosen serviceCode if
 * valid, else the cheapest). Each option carries carrier cost, brand cost (carrier
 * + pick-&-pack, what the wallet pays), and customer price (+ markup). Always
 * returns the flat fallback if live rating is unavailable, so an order can always
 * be priced and checkout never blocks.
 */
export async function priceShipping(
  plan: PlanKey,
  parcel: { weightOz: number; lengthIn: number; widthIn: number; heightIn: number },
  dest: { toZip: string; toState: string },
  serviceCode?: string,
  pricing?: ShippingPricing,
): Promise<ShippingQuote> {
  const pp: ShippingPricing = pricing ?? { pickpackCents: loadConfig().SHIPPING_PICKPACK_FEE_CENTS, markupCents: 0 };
  const flat = priceOption(FLAT_FALLBACK, pp, true);

  if (PLANS[plan].capabilities.shipping === 'flat') {
    return { source: 'flat', options: [flat], chosen: flat };
  }

  const cfg = loadConfig();
  const { source, options } = await quoteRates({
    fromZip: cfg.WAREHOUSE_FROM_ZIP,
    toZip: dest.toZip,
    toState: dest.toState,
    toCountry: 'US',
    weightOz: parcel.weightOz,
    lengthIn: parcel.lengthIn || undefined,
    widthIn: parcel.widthIn || undefined,
    heightIn: parcel.heightIn || undefined,
  });
  if (options.length === 0) return { source: 'fallback', options: [flat], chosen: flat };

  const priced = options.map((o) => priceOption(o, pp, false));
  const chosen = (serviceCode && priced.find((o) => o.serviceCode === serviceCode)) || priced[0]!;
  return { source, options: priced, chosen };
}
