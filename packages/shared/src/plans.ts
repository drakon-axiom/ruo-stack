/**
 * Subscription plan vocabulary — tier keys, structural mappings, and display
 * fallbacks. Pricing and capabilities are NOT here: they live in the `plan` /
 * `plan_price` tables and are resolved at runtime by
 * `apps/api/src/services/plan-registry.ts`. That split is deliberate — see
 * the module comment on `PLAN_SEED` below for why.
 */
export const PLAN_KEYS = ['starter', 'pro', 'volume'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

/** Plans that require a real Stripe subscription (Starter is the free default). */
export const PAID_PLAN_KEYS = ['pro', 'volume'] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

export interface PlanCapabilities {
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
  /** CatalogProduct column for this tier's wholesale cost. */
  wholesaleField: 'wholesaleStarter' | 'wholesalePro' | 'wholesaleVolume';
  capabilities: PlanCapabilities;
  /** Display bullets for the plan card. */
  features: string[];
}

/**
 * The values migration 00000000000030 used to seed the `plan` and
 * `plan_price` tables — that seed (`apps/api/src/scripts/seed-plans.ts`) is
 * the ONLY reader of this constant, and only for `priceCents`, only to log a
 * discrepancy against what Stripe actually returns. Nothing else may read
 * this: the database (`plan`/`plan_price`) is the runtime source of truth,
 * resolved via `getPlanRegistry()`. Editing a price here would do nothing —
 * it is not exported as a price, it has no runtime reader that charges
 * anyone — which is the point. The bug this whole project exists to close
 * was a price constant that looked authoritative and wasn't.
 */
export const PLAN_SEED: Record<PlanKey, PlanDef & { priceCents: number }> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    priceCents: 0,
    wholesaleField: 'wholesaleStarter',
    capabilities: { storeConnections: false, maxOrdersPerMonth: 20, shipping: 'flat', shippingCutoff: '10 AM CST' },
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
    wholesaleField: 'wholesalePro',
    capabilities: { storeConnections: true, maxOrdersPerMonth: null, shipping: 'live', shippingCutoff: '12 PM CST' },
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
    wholesaleField: 'wholesaleVolume',
    capabilities: { storeConnections: true, maxOrdersPerMonth: null, shipping: 'live', shippingCutoff: '2 PM CST' },
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

/**
 * Maps a tier to the `CatalogProduct` column holding its wholesale cost.
 * Structural, not a business setting — changing it requires a schema change,
 * not a price edit. Must never become admin-editable.
 */
export function wholesaleFieldFor(plan: PlanKey): PlanDef['wholesaleField'] {
  return PLAN_SEED[plan].wholesaleField;
}

/** Display-name fallback keyed by tier — the values here match `PLAN_SEED[key].name`
 * but exist independently so callers that only have a `PlanKey` (no registry
 * fetch in hand) can still render a label. Prefer the registry's `name` when
 * available; fall back to this when a tier name is needed synchronously. */
export const PLAN_LABEL: Record<PlanKey, string> = { starter: 'Starter', pro: 'Pro', volume: 'Volume' };

export function planLabel(key: PlanKey): string {
  return PLAN_LABEL[key];
}
