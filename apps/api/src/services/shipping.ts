import { PLANS, SHIPPING_FLAT_CENTS, type PlanKey, type RateOption } from '@ruostack/shared';
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
  source: string; // 'flat' | 'computed' | 'shipstation'
  options: RateOption[];
  chosen: RateOption;
}

const FLAT_OPTION: RateOption = {
  carrier: 'USPS',
  service: 'Flat Rate',
  serviceCode: 'flat',
  amountCents: SHIPPING_FLAT_CENTS,
};

/**
 * Price shipping for a plan + parcel + destination. Starter → flat; Pro/Volume →
 * live rates (the chosen serviceCode if valid, else the cheapest). Always returns
 * a chosen option so an order can be priced even if live rating is unavailable.
 */
export async function priceShipping(
  plan: PlanKey,
  parcel: { weightOz: number; lengthIn: number; widthIn: number; heightIn: number },
  dest: { toZip: string; toState: string },
  serviceCode?: string,
): Promise<ShippingQuote> {
  if (PLANS[plan].capabilities.shipping === 'flat') {
    return { source: 'flat', options: [FLAT_OPTION], chosen: FLAT_OPTION };
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
  if (options.length === 0) return { source: 'flat', options: [FLAT_OPTION], chosen: FLAT_OPTION };
  const chosen = (serviceCode && options.find((o) => o.serviceCode === serviceCode)) || options[0]!;
  return { source, options, chosen };
}
