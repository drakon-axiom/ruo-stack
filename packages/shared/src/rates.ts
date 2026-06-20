/**
 * Shipping rate seam (mirrors PaymentsAdapter). Core/order code asks the
 * RatesAdapter for options; the concrete source (ShipStation, a computed table,
 * EasyPost later) is swappable. Origin is RUOStack's warehouse (platform config),
 * since fulfillment ships from RUOStack under the brand's label.
 */
export interface RateQuoteInput {
  fromZip: string;
  toZip: string;
  toState: string;
  toCountry: string; // 'US'
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  residential?: boolean;
}

export interface RateOption {
  carrier: string; // 'USPS' | 'UPS' | 'FedEx' | …
  service: string; // human label, e.g. 'Ground Advantage'
  serviceCode: string; // stable id used on the order
  amountCents: number;
  estDays?: number;
}

export interface RatesAdapter {
  /** The source identifier ('shipstation' | 'computed') — surfaced for transparency. */
  readonly source: string;
  getRates(input: RateQuoteInput): Promise<RateOption[]>;
}

// ── Rate pricing model (fulfillment plan §4/§12) ──────────────────────────────
// price shown to the customer = carrier rate + pick-&-pack fee (hidden, RUOStack's
// margin) + per-brand markup (brand's shipping profit). The brand's WALLET is
// debited carrier + pick-&-pack only (markup is the brand's, collected by their
// gateway). Pick-&-pack is NEVER itemized to the customer.

/** Default pick-&-pack fee (cents) when no global/brand override is configured. */
export const PICKPACK_FEE_DEFAULT_CENTS = 250;

/** Service tiers offered at checkout (fulfillment plan §12.2). No overnight. */
export const SERVICE_TIERS = ['economy', 'standard', 'expedited'] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

/** Single $12.99 flat fallback, fulfilled as USPS Ground Advantage — returned when
 * live rates time out/error or a SKU is unmapped/missing weight. Checkout always
 * returns something. */
export const FLAT_FALLBACK = {
  carrier: 'USPS',
  service: 'Standard Shipping (2–5 business days)',
  serviceCode: 'usps_ground_advantage',
  amountCents: 1299,
} as const;

export interface ShippingPricing {
  /** Pick-&-pack fee in cents (RUOStack margin) — resolved override ?? global. */
  pickpackCents: number;
  /** Per-brand markup in cents (brand's shipping profit; default 0). */
  markupCents: number;
}

export interface PricedRateOption {
  carrier: string;
  service: string;
  serviceCode: string;
  carrierCents: number; // pass-through carrier cost
  amountCents: number; // brand cost = carrier + pick-&-pack (what the wallet pays)
  customerCents: number; // carrier + pick-&-pack + markup (shown at checkout)
  estDays?: number;
}

/**
 * Apply the pricing model to one raw carrier rate. `isFlat` marks the $12.99 flat
 * fallback as an all-in price (no pick-&-pack added on top).
 */
export function priceOption(raw: RateOption, pricing: ShippingPricing, isFlat = false): PricedRateOption {
  const carrierCents = raw.amountCents;
  const amountCents = isFlat ? carrierCents : carrierCents + pricing.pickpackCents;
  return {
    carrier: raw.carrier,
    service: raw.service,
    serviceCode: raw.serviceCode,
    carrierCents,
    amountCents,
    customerCents: amountCents + pricing.markupCents,
    estDays: raw.estDays,
  };
}

// Note: shipping LABELS are bought inside ShipStation during fulfillment (Custom
// Store model), so there is no LabelsAdapter — this seam quotes rates only.
