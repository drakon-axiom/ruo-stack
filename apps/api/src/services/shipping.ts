import type { PrismaClient, ServiceMapping } from '@ruostack/db';
import {
  FLAT_FALLBACK,
  PLANS,
  priceOption,
  type PlanKey,
  type PricedRateOption,
  type ShippingPricing,
} from '@ruostack/shared';
import { loadConfig } from '../config.ts';
import { cachedQuoteRates } from './rate-cache.ts';
import { computeParcel, curateRates } from './fulfillment-rules.ts';

// Parcel + rules-engine helpers live in fulfillment-rules; re-exported so existing
// importers keep a stable path.
export { computeParcel, deriveParcel, loadShippingRules, orderBoxFields, selectBox, DEFAULT_ITEM_WEIGHT_OZ, type ParcelProduct, type DerivedParcel } from './fulfillment-rules.ts';

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
  const cfg = await db.brandShippingConfig.findUnique({ where: { brandId }, select: { pickpackFeeOverrideCents: true, markupCents: true, enabledServices: true } });
  return {
    pickpackCents: cfg?.pickpackFeeOverrideCents ?? loadConfig().SHIPPING_PICKPACK_FEE_CENTS,
    markupCents: cfg?.markupCents ?? 0,
    enabledServices: cfg?.enabledServices ?? [],
  };
}

/**
 * Price shipping for a plan + parcel + destination. Starter → flat $12.99; Pro/
 * Volume → live rates, curated through the ServiceMapping rules (named services,
 * eligibility by billable weight, least-cost per tier) when `mappings` is supplied,
 * then the pick-&-pack fee applied. Each option carries carrier cost, brand cost
 * (carrier + pick-&-pack, what the wallet pays), and customer price (+ markup).
 * Always returns the flat fallback if live rating/curation yields nothing, so an
 * order can always be priced and checkout never blocks.
 */
export async function priceShipping(
  plan: PlanKey,
  parcel: { weightOz: number; lengthIn: number; widthIn: number; heightIn: number },
  dest: { toZip: string; toState: string },
  serviceCode?: string,
  pricing?: ShippingPricing,
  mappings?: ServiceMapping[],
): Promise<ShippingQuote> {
  const pp: ShippingPricing = pricing ?? { pickpackCents: loadConfig().SHIPPING_PICKPACK_FEE_CENTS, markupCents: 0 };
  const flat = priceOption(FLAT_FALLBACK, pp, true);

  if (PLANS[plan].capabilities.shipping === 'flat') {
    return { source: 'flat', options: [flat], chosen: flat };
  }

  const cfg = loadConfig();
  const { source, options } = await cachedQuoteRates({
    fromZip: cfg.WAREHOUSE_FROM_ZIP,
    toZip: dest.toZip,
    toState: dest.toState,
    toCountry: 'US',
    weightOz: parcel.weightOz,
    lengthIn: parcel.lengthIn || undefined,
    widthIn: parcel.widthIn || undefined,
    heightIn: parcel.heightIn || undefined,
  });
  // Curate through the service rules (when configured); empty → flat fallback.
  const rulesCurated = mappings ? curateRates(options, mappings, parcel.weightOz) : options;
  // Scope to the brand's allowed services when configured (empty = no restriction).
  const allowed = pp.enabledServices;
  const curated = allowed && allowed.length > 0 ? rulesCurated.filter((o) => allowed.includes(o.serviceCode)) : rulesCurated;
  if (curated.length === 0) return { source: 'fallback', options: [flat], chosen: flat };

  const priced = curated.map((o) => priceOption(o, pp, false));
  const chosen = (serviceCode && priced.find((o) => o.serviceCode === serviceCode)) || priced[0]!;
  return { source, options: priced, chosen };
}
