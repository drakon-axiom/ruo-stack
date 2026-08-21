/**
 * Subscription plan vocabulary — tier keys, structural mappings, and display
 * fallbacks. Pricing and capabilities are NOT here: they live in the `plan` /
 * `plan_price` tables and are resolved at runtime by
 * `apps/api/src/services/plan-registry.ts`. This module exports NO price
 * data at all — that is deliberate. The bug this whole project exists to
 * close was a price constant that looked authoritative and wasn't; the fix
 * is that no such constant exists to look at.
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

/** The `CatalogProduct` column holding each tier's wholesale cost. */
export type WholesaleField = 'wholesaleStarter' | 'wholesalePro' | 'wholesaleVolume';

/**
 * Maps a tier to its wholesale `CatalogProduct` column. Structural, not a
 * business setting — changing it requires a schema change, not a price edit.
 * Must never become admin-editable. Read forever, in production, by
 * `wholesaleFieldFor()` below and (through it) `brand.ts:244`,
 * `brand-orders.ts:60,149`, `order-edit.ts:42`, `store-intake.ts:83`.
 * Carries no price data — nothing here can be mistaken for a price source.
 */
export const WHOLESALE_FIELD_BY_PLAN: Record<PlanKey, WholesaleField> = {
  starter: 'wholesaleStarter',
  pro: 'wholesalePro',
  volume: 'wholesaleVolume',
};

export function wholesaleFieldFor(plan: PlanKey): WholesaleField {
  return WHOLESALE_FIELD_BY_PLAN[plan];
}

/** Display-name fallback keyed by tier, for callers that only have a
 * `PlanKey` (no registry fetch in hand) and still need to render a label.
 * Prefer the registry's `name` when available; fall back to this when a
 * tier name is needed synchronously. */
export const PLAN_LABEL: Record<PlanKey, string> = { starter: 'Starter', pro: 'Pro', volume: 'Volume' };

export function planLabel(key: PlanKey): string {
  return PLAN_LABEL[key];
}
