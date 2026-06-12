import type { PrismaClient, SubscriptionStateStatus } from '@ruostack/db';

/**
 * Membership state. Driven ONLY by billing webhooks — never by wallet flows
 * (architecture §4.1). Upserts SubscriptionState and mirrors the coarse
 * Brand.subscription_status convenience flag (SubscriptionState is the SoT).
 */
export interface SubscriptionUpdate {
  brandId: string;
  status: SubscriptionStateStatus;
  stripeSubscriptionId?: string | null;
  price?: number; // cents
  currentPeriodEnd?: Date | null;
}

export async function upsertSubscriptionState(db: PrismaClient, u: SubscriptionUpdate): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.subscriptionState.upsert({
      where: { brandId: u.brandId },
      create: {
        brandId: u.brandId,
        status: u.status,
        stripeSubscriptionId: u.stripeSubscriptionId ?? null,
        price: u.price ?? 0,
        currentPeriodEnd: u.currentPeriodEnd ?? null,
      },
      update: {
        status: u.status,
        ...(u.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: u.stripeSubscriptionId } : {}),
        ...(u.price !== undefined ? { price: u.price } : {}),
        ...(u.currentPeriodEnd !== undefined ? { currentPeriodEnd: u.currentPeriodEnd } : {}),
      },
    });
    // Mirror the coarse flag: 'pro' only while active; otherwise 'none'.
    await tx.brand.update({
      where: { id: u.brandId },
      data: { subscriptionStatus: u.status === 'active' ? 'pro' : 'none' },
    });
  });
}

/** Is the brand currently entitled to Pro features (gating)? */
export function isProActive(status: SubscriptionStateStatus | undefined): boolean {
  return status === 'active';
}
