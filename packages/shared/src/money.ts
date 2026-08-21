import { z } from 'zod';
import { PAID_PLAN_KEYS } from './plans.ts';

/** Wallet ledger entry types (architecture §4.1). Phase 1 exercises deposit /
 * refund_credit / manual_adjustment; hold/capture arrive with the order pipe. */
export const WALLET_TXN_TYPES = [
  'deposit',
  'hold',
  'hold_release',
  'capture',
  'refund_credit',
  'referral_credit',
  'manual_adjustment',
] as const;
export type WalletTxnType = (typeof WALLET_TXN_TYPES)[number];

// `suspended` is retained for historical rows only — see migration 025/026.
export const SUBSCRIPTION_STATUSES = ['none', 'active', 'past_due', 'expired', 'cancelled', 'suspended'] as const;
export type SubscriptionStatusState = (typeof SUBSCRIPTION_STATUSES)[number];

/** Wallet top-up. Funds are NON-REFUNDABLE / non-withdrawable (closed-loop,
 * payments §2/§4) — an explicit acknowledgment is required at deposit time. */
export const WalletTopupSchema = z.object({
  amount_cents: z.number().int().min(1000).max(1_000_000), // $10 – $10,000
  acknowledge: z.literal(true, {
    errorMap: () => ({ message: 'You must acknowledge that wallet funds are non-refundable' }),
  }),
});
export type WalletTopup = z.infer<typeof WalletTopupSchema>;

/**
 * Subscribe to a PAID plan (Starter is free — selected by cancelling, not
 * here). `price_version_id` is the `plan_price.id` the plan card's displayed
 * price came from (see `GET /api/brand/subscription`'s `plans[].price_version_id`)
 * — the checkout quote token. REQUIRED, not optional-but-validated: an
 * omitted token would silently fall back to resolving the price at click
 * time, which is exactly the race this field exists to close. `brand-web` is
 * the only caller and ships in the same deploy as this schema, so there is
 * no in-flight-client window to protect against — an old bundle cached in an
 * already-open tab is a version-skew risk every breaking API change already
 * carries, not one specific to this field.
 */
export const SubscribeSchema = z.object({
  plan: z.enum(PAID_PLAN_KEYS),
  price_version_id: z.string().uuid(),
});
export type Subscribe = z.infer<typeof SubscribeSchema>;

/** A brand's own retail price for a product (overrides the operator suggestion). */
export const BrandRetailSchema = z.object({ retail_cents: z.number().int().nonnegative().max(100_000_000) });
export type BrandRetail = z.infer<typeof BrandRetailSchema>;

/** Finance-only manual wallet adjustment (architecture §1.2; audited). */
export const WalletAdjustSchema = z.object({
  // Bounded like every other money field — a manual adjustment is an audited but
  // irreversible ledger write, so a fat-finger/compromised session can't move a
  // wallet by trillions. ±$1,000,000 per adjustment.
  amount_cents: z
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((v) => v !== 0, 'Amount cannot be zero'),
  reason: z.string().min(1).max(500),
});
export type WalletAdjust = z.infer<typeof WalletAdjustSchema>;
