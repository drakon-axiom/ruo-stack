import type { PrismaClient, PlanTier, SubscriptionState, SubscriptionStateStatus } from '@ruostack/db';
import { AUDIT_ACTIONS, type PlanKey } from '@ruostack/shared';
import { writeAudit } from '../audit.ts';

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
 * Safety margin past `currentPeriodEnd` before entitlement drops.
 *
 * Absorbs the lag between a renewal happening and us hearing about it — a
 * delayed webhook, a gateway retry, a bank holiday on a manual transfer. Fixed
 * rather than configurable so the sweep worker and every request path can never
 * disagree about when a subscription lapsed; there is exactly one number.
 *
 * Distinct from DUNNING_GRACE_DAYS, which is a business policy about how long a
 * KNOWN failed payment keeps its features. This is a tolerance for our own
 * bookkeeping being behind.
 */
export const LAPSE_GRACE_DAYS = 3;
export const LAPSE_GRACE_MS = LAPSE_GRACE_DAYS * 86_400_000;

/**
 * Has the brand's paid-through date passed (beyond the grace margin)?
 *
 * `currentPeriodEnd` is the LOCAL record of what the brand has paid for,
 * whatever took the money — a Stripe webhook, some future gateway, or an admin
 * recording a manual payment. Entitlement is derived from it here rather than
 * from any one processor's status, so no gateway is load-bearing.
 *
 * A null date means NO expiry, not "expired": that's a comped or manually
 * granted membership with no end. Every payment path that does know an end date
 * must set one.
 */
export function isLapsed(state: Pick<SubscriptionState, 'currentPeriodEnd'>, now: Date = new Date()): boolean {
  if (!state.currentPeriodEnd) return false;
  return now.getTime() > state.currentPeriodEnd.getTime() + LAPSE_GRACE_MS;
}

/**
 * The brand's effective entitled tier: their plan while the subscription is
 * active OR past_due (the dunning grace window keeps Pro features so a transient
 * failure doesn't instantly break checkout); 'starter' once suspended/cancelled/
 * none. The worker flips past_due → suspended after the grace window.
 *
 * ALSO 'starter' once the paid-through date has lapsed, regardless of what
 * `status` says. Status is only ever as fresh as the last event we received, so
 * trusting it alone means one missed webhook grants Pro indefinitely — which is
 * exactly what happened: a subscription cancelled at period end kept full Pro
 * for weeks because the `deleted` event never arrived. The date is the thing we
 * can check without asking anyone, so the date is what decides.
 */
export function effectivePlan(
  state: Pick<SubscriptionState, 'plan' | 'status' | 'currentPeriodEnd'> | null,
  now: Date = new Date(),
): PlanKey {
  if (!state) return 'starter';
  if (state.status !== 'active' && state.status !== 'past_due') return 'starter';
  if (isLapsed(state, now)) return 'starter';
  return state.plan;
}

export interface LapseSweepResult {
  examined: number;
  suspended: number;
}

/**
 * Flip subscriptions whose paid-through date has lapsed to `expired`.
 *
 * Purely LOCAL — it reads our own `currentPeriodEnd` and calls no payment
 * processor. That is the point: the mechanism has to hold for Stripe, for any
 * gateway we add later, and for a manual bank transfer an admin recorded by
 * hand. Whatever collected the money, it did the same one thing — moved the
 * paid-through date forward. If nothing moved it, the membership lapsed.
 *
 * `effectivePlan` already refuses entitlement past the grace margin, so this is
 * not what protects the features; it is what makes the stored row agree with
 * the answer, so admin screens, exports and support aren't reading a status
 * that quietly stopped being true.
 */
export async function sweepLapsedSubscriptions(prisma: PrismaClient, now: Date = new Date()): Promise<LapseSweepResult> {
  const cutoff = new Date(now.getTime() - LAPSE_GRACE_MS);
  const lapsed = await prisma.subscriptionState.findMany({
    where: {
      status: { in: ['active', 'past_due'] },
      currentPeriodEnd: { not: null, lt: cutoff },
    },
    select: { brandId: true, plan: true, status: true, currentPeriodEnd: true },
  });

  for (const s of lapsed) {
    await upsertSubscriptionState(prisma, { brandId: s.brandId, status: 'expired', plan: s.plan });
    await writeAudit(prisma, {
      actorType: 'system',
      actorId: null,
      action: AUDIT_ACTIONS.subscriptionStatusChanged,
      targetType: 'brand',
      targetId: s.brandId,
      before: { status: s.status },
      after: {
        status: 'expired',
        reason: 'paid_through_lapsed',
        paid_through: s.currentPeriodEnd?.toISOString() ?? null,
        grace_days: LAPSE_GRACE_DAYS,
      },
      ip: null,
    });
  }
  return { examined: lapsed.length, suspended: lapsed.length };
}

/** Periodic lapse sweep (runs on start, then every interval). Unref'd. */
export function startSubscriptionLapseWorker(prisma: PrismaClient, intervalMs: number, log?: (m: string) => void): () => void {
  const tick = () => {
    sweepLapsedSubscriptions(prisma)
      .then((r) => { if (r.suspended) log?.(`subscription lapse: suspended ${r.suspended}`); })
      .catch((err) => log?.(`subscription lapse sweep failed: ${err instanceof Error ? err.message : err}`));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
