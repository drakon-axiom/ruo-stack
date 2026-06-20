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
    const existing = await tx.subscriptionState.findUnique({ where: { brandId: u.brandId }, select: { status: true } });
    // Dunning timestamps: stamp pastDueSince when ENTERING past_due (keep the
    // original on repeated failure events); clear both once payment recovers.
    const dunning: { pastDueSince?: Date | null; dunningNotifiedAt?: Date | null } =
      u.status === 'past_due'
        ? existing?.status === 'past_due'
          ? {}
          : { pastDueSince: new Date(), dunningNotifiedAt: null }
        : u.status === 'active'
          ? { pastDueSince: null, dunningNotifiedAt: null }
          : {};

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
        pastDueSince: u.status === 'past_due' ? new Date() : null,
      },
      update: {
        status: u.status,
        ...(u.plan !== undefined ? { plan: u.plan } : {}),
        ...(u.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: u.stripeSubscriptionId } : {}),
        ...(u.price !== undefined ? { price: u.price } : {}),
        ...(u.currentPeriodEnd !== undefined ? { currentPeriodEnd: u.currentPeriodEnd } : {}),
        ...(u.cancelAtPeriodEnd !== undefined ? { cancelAtPeriodEnd: u.cancelAtPeriodEnd } : {}),
        ...dunning,
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
 * active OR past_due (the dunning grace window keeps Pro features so a transient
 * failure doesn't instantly break checkout); 'starter' once suspended/cancelled/
 * none. The worker flips past_due → suspended after the grace window.
 */
export function effectivePlan(state: Pick<SubscriptionState, 'plan' | 'status'> | null): PlanKey {
  if (!state) return 'starter';
  if (state.status === 'active' || state.status === 'past_due') return state.plan;
  return 'starter';
}
