import type { PrismaClient, PlanTier, SubscriptionState, SubscriptionStateStatus } from '@ruostack/db';
import type { PlanKey } from '@ruostack/shared';

/**
 * Membership state. Driven ONLY by billing webhooks — never by wallet flows
 * (architecture §4.1). Upserts SubscriptionState and mirrors the coarse
 * Brand.subscription_status flag. The tier lives in SubscriptionState.plan.
 */
export interface SubscriptionUpdate {
  brandId: string;
  status: SubscriptionStateStatus;
  /** Resolved tier (from the Stripe price). Omit to leave the existing plan. */
  plan?: PlanTier;
  stripeSubscriptionId?: string | null;
  price?: number; // cents
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

export async function upsertSubscriptionState(db: PrismaClient, u: SubscriptionUpdate): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.subscriptionState.upsert({
      where: { brandId: u.brandId },
      create: {
        brandId: u.brandId,
        status: u.status,
        plan: u.plan ?? 'pro', // a paid subscription event implies a paid tier
        stripeSubscriptionId: u.stripeSubscriptionId ?? null,
        price: u.price ?? 0,
        currentPeriodEnd: u.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: u.cancelAtPeriodEnd ?? false,
      },
      update: {
        status: u.status,
        ...(u.plan !== undefined ? { plan: u.plan } : {}),
        ...(u.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: u.stripeSubscriptionId } : {}),
        ...(u.price !== undefined ? { price: u.price } : {}),
        ...(u.currentPeriodEnd !== undefined ? { currentPeriodEnd: u.currentPeriodEnd } : {}),
        ...(u.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: u.cancelAtPeriodEnd } : {}),
      },
    });
    // Coarse mirror: 'pro' while on any active paid tier, else 'none'.
    const entitled = row.status === 'active' && row.plan !== 'starter';
    await tx.brand.update({
      where: { id: u.brandId },
      data: { subscriptionStatus: entitled ? 'pro' : 'none' },
    });
  });
}

/**
 * The brand's effective entitled tier: their plan while the subscription is
 * active, otherwise 'starter' (the free default — e.g. past_due/cancelled fall
 * back to Starter access until resolved).
 */
export function effectivePlan(state: Pick<SubscriptionState, 'plan' | 'status'> | null): PlanKey {
  if (!state || state.status !== 'active') return 'starter';
  return state.plan;
}
