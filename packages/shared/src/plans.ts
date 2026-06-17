/**
 * Subscription plan registry — the single source of truth for tiers, prices,
 * and capabilities. Both backend (gating, Checkout) and frontend (plan cards)
 * read from here. Wholesale is tiered: every plan gets wholesale pricing, but
 * higher tiers get better rates (see CatalogProduct.wholesale{Starter,Pro,Volume}).
 */
export const PLAN_KEYS = ['starter', 'pro', 'volume'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Plans that require a real Stripe subscription (Starter is the free default). */
export const PAID_PLAN_KEYS = ['pro', 'volume'] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

export interface PlanCapabilities {
  /** All tiers get wholesale pricing; the *rate* differs per tier. */
  wholesale: true;
  /** Connect a WooCommerce/Wix store (Phase 2). */
  storeConnections: boolean;
  /** Orders/month cap; null = unlimited. Enforced once the order pipe exists. */
  maxOrdersPerMonth: number | null;
  /** Shipping pricing mode (flat rate vs live carrier rates; Phase 2 rate engine). */
  shipping: 'flat' | 'live';
  /** Same-day shipping cutoff (CST) — later tiers ship later in the day. */
  shippingCutoff: string;
}

export interface PlanDef {
  key: PlanKey;
  name: string;
  priceCents: number;
  paid: boolean;
  /** Env var holding the Stripe recurring price id (paid plans only). */
  stripePriceEnv?: 'STRIPE_PRO_PRICE_ID' | 'STRIPE_VOLUME_PRICE_ID';
  /** CatalogProduct column for this tier's wholesale cost. */
  wholesaleField: 'wholesaleStarter' | 'wholesalePro' | 'wholesaleVolume';
  capabilities: PlanCapabilities;
  /** Display bullets for the plan card. */
  features: string[];
}

export const PLANS: Record<PlanKey, PlanDef> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    priceCents: 0,
    paid: false,
    wholesaleField: 'wholesaleStarter',
    capabilities: { wholesale: true, storeConnections: false, maxOrdersPerMonth: 20, shipping: 'flat', shippingCutoff: '10 AM CST' },
    features: [
      'Wholesale pricing — Starter rate',
      'Manual orders — up to 20 / month',
      'Flat-rate shipping',
      '10 AM CST shipping cutoff',
      'No store connections',
    ],
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    priceCents: 4900,
    paid: true,
    stripePriceEnv: 'STRIPE_PRO_PRICE_ID',
    wholesaleField: 'wholesalePro',
    capabilities: { wholesale: true, storeConnections: true, maxOrdersPerMonth: null, shipping: 'live', shippingCutoff: '12 PM CST' },
    features: [
      'Better wholesale pricing — Pro rate',
      'Unlimited orders',
      'Live carrier rates',
      '12 PM CST shipping cutoff',
      'Store connections (WooCommerce, Wix)',
    ],
  },
  volume: {
    key: 'volume',
    name: 'Volume',
    priceCents: 14900,
    paid: true,
    stripePriceEnv: 'STRIPE_VOLUME_PRICE_ID',
    wholesaleField: 'wholesaleVolume',
    capabilities: { wholesale: true, storeConnections: true, maxOrdersPerMonth: null, shipping: 'live', shippingCutoff: '2 PM CST' },
    features: [
      'Best wholesale pricing — Volume rate',
      'Unlimited orders',
      'Live carrier rates',
      '2 PM CST shipping cutoff',
      'Store connections (WooCommerce, Wix)',
      'Priority fulfillment',
    ],
  },
};

export const PLAN_LIST: PlanDef[] = [PLANS.starter, PLANS.pro, PLANS.volume];

export function wholesaleFieldFor(plan: PlanKey): PlanDef['wholesaleField'] {
  return PLANS[plan].wholesaleField;
}
