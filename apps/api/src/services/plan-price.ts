import type { PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, type PaymentsAdapter, type PlanKey } from '@ruostack/shared';
import { writeAudit } from '../audit.ts';
import { BadRequest, Conflict } from '../errors.ts';
import { invalidatePlanRegistry } from './plan-registry.ts';

/**
 * The price-change transaction — the operation this whole plan exists to
 * make possible, and the only place that writes both `plan_price` and
 * Stripe for the same edit.
 *
 * Ordering principle: create the inert thing first, commit the authoritative
 * thing second, clean up third. A Stripe Price nobody points at charges
 * nobody; a DB row pointing at nothing charges nobody. Only the `active`
 * flip is load-bearing, and it is one atomic commit.
 *
 *   Step A (DB tx, no side effects) — insert a PENDING row (`active: false`,
 *     `stripePriceId: null`) plus an audit entry. Reused on retry: a second
 *     call for the same (plan, priceCents) finds and reuses this row instead
 *     of minting a duplicate.
 *   Step B (Stripe) — `payments.createPrice()` with `priceVersionId` set to
 *     the PENDING row's id. StripeAdapter derives its idempotency key from
 *     that id (`price:${priceVersionId}`) — a key created BEFORE the side
 *     effect it protects, which is what makes a retry safe. Keying on
 *     `plan`+`amount` instead would be wrong: a 4900→5900→4900 revert would
 *     collide with the first (now-archived) attempt and return an inactive
 *     Price that can't accept new subscriptions.
 *   Step C (one atomic $transaction) — stamp the Stripe id onto the pending
 *     row, deactivate whatever was active, activate the pending row, write
 *     the audit with before/after + the mandatory reason. The partial
 *     unique index `plan_price_one_active_per_plan` forces
 *     deactivate-before-activate — the database enforces the ordering.
 *   Step D (post-commit, best-effort) — archive the old Stripe price.
 *     Deliberately outside the transaction: archiving is idempotent and
 *     non-destructive (does not affect subscriptions already on that price),
 *     so a failure here is cosmetic Stripe clutter, never a reason to roll
 *     back correct DB state.
 *
 * Takes the PaymentsAdapter as a parameter, not via getClients() — the seam
 * tests inject a FakePaymentsAdapter through.
 *
 * NEVER pass a transaction client to getPlanRegistry() from in here — it
 * would cache uncommitted rows process-globally for up to
 * PLAN_CACHE_TTL_SECONDS, surviving a rollback. invalidatePlanRegistry() is
 * called only after the Step C transaction commits, never inside it.
 */

/** A change of more than this fraction (either direction) requires confirm_large_change. */
const LARGE_CHANGE_THRESHOLD = 0.5;

export interface ChangePlanPriceInput {
  plan: PlanKey;
  priceCents: number;
  reason: string;
  /** Required when the new price differs from the current one by more than ±50%. */
  confirmLargeChange?: boolean;
  actorId: string;
  ip?: string | null;
}

export interface ChangePlanPriceResult {
  planPriceId: string;
  priceCents: number;
  stripePriceId: string;
  previousPriceCents: number | null;
  previousStripePriceId: string | null;
}

export async function changePlanPrice(
  prisma: PrismaClient,
  payments: PaymentsAdapter,
  input: ChangePlanPriceInput,
): Promise<ChangePlanPriceResult> {
  const { plan, priceCents, reason, confirmLargeChange, actorId, ip } = input;

  // ── Guards. All of them must reject before any Stripe call — checked here,
  // before Step A even writes an inert DB row. ─────────────────────────────

  if (plan === 'starter') {
    throw BadRequest('starter_is_free', 'Starter is free and has no Stripe price to change.');
  }

  const planRow = await prisma.plan.findUnique({ where: { key: plan } });
  if (!planRow) {
    throw new Error(`[plan-price] Missing "plan" row for tier "${plan}" — run the plan seed.`);
  }
  if (!planRow.stripeProductId) {
    throw new Error(
      `[plan-price] "${plan}" has no stripe_product_id — cannot create a new Price generation. Run the plan seed.`,
    );
  }

  const currentActive = await prisma.planPrice.findFirst({ where: { plan, active: true } });

  if (currentActive && currentActive.priceCents === priceCents) {
    throw Conflict('price_unchanged', `"${plan}" is already priced at ${priceCents} cents.`);
  }

  // Phase 2 (the subscriber-migration worker) is deliberately not built yet.
  // Without this guard a price change would silently strand existing
  // subscribers on the old price with no record of who is on what.
  //
  // `SubscriptionState` is one row per brand and `plan` is never reset on
  // churn (webhook.ts passes the resolved tier through on `cancelled` too),
  // so a brand that churned off this tier keeps `plan: <tier>` forever with
  // `status: 'cancelled'`/`'expired'`/`'suspended'`/`'none'`. Counting all
  // rows for the plan (no status filter) would count every brand that has
  // EVER been on the tier, blocking repricing permanently after the first
  // churn — fail-closed in the wrong direction, and the reported count would
  // be flatly false. Match plan-preflight.ts's query (the script this exact
  // guard was designed to be checked against) and every other subscriber-
  // count consumer (reporting.ts, admin-overview.ts, brand-overview.ts):
  // only `active`/`past_due` are live risk, and only a row with a real
  // Stripe subscription can be stranded by a reprice — a comped/manual
  // membership has none to migrate.
  const subscriberCount = await prisma.subscriptionState.count({
    where: { plan, status: { in: ['active', 'past_due'] }, stripeSubscriptionId: { not: null } },
  });
  if (subscriberCount > 0) {
    throw Conflict(
      'migration_required',
      `"${plan}" has ${subscriberCount} existing subscriber(s). Repricing would strand them on the old price — ` +
        `the subscriber-migration worker (Phase 2) is not built yet.`,
    );
  }

  if (currentActive && currentActive.priceCents > 0) {
    const delta = Math.abs(priceCents - currentActive.priceCents) / currentActive.priceCents;
    if (delta > LARGE_CHANGE_THRESHOLD && !confirmLargeChange) {
      throw Conflict(
        'confirm_large_change_required',
        `Changing "${plan}" from ${currentActive.priceCents}c to ${priceCents}c is a ` +
          `${(delta * 100).toFixed(0)}% change. Resubmit with confirm_large_change: true to proceed.`,
      );
    }
  }

  // ── Step A — insert (or reuse) a PENDING row. No Stripe call yet. ────────

  let pending = await prisma.planPrice.findFirst({
    where: { plan, priceCents, active: false, stripePriceId: null },
  });

  if (!pending) {
    pending = await prisma.$transaction(async (tx) => {
      const row = await tx.planPrice.create({
        data: { plan, priceCents, stripePriceId: null, active: false, createdBy: actorId },
      });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId,
        action: AUDIT_ACTIONS.planPricePending,
        targetType: 'plan_price',
        targetId: row.id,
        before: null,
        after: { plan, priceCents: row.priceCents },
        reason,
        ip,
      });
      return row;
    });
  }

  // ── Step B — create the Stripe Price. Idempotency key derives from the
  // pending row's id (created before this side effect), inside createPrice(). ──

  const { priceId } = await payments.createPrice({
    productId: planRow.stripeProductId,
    amountCents: priceCents,
    currency: 'usd',
    interval: 'month',
    planKey: plan,
    priceVersionId: pending.id,
  });

  // ── Step C — one atomic commit: stamp the Stripe id, deactivate the old
  // active row, activate the pending row, write the audit. ─────────────────

  const pendingId = pending.id;
  const committed = await prisma.$transaction(async (tx) => {
    await tx.planPrice.update({ where: { id: pendingId }, data: { stripePriceId: priceId } });

    // Re-read inside the transaction — the outer `currentActive` read is
    // stale by the time Stripe has round-tripped.
    const oldActive = await tx.planPrice.findFirst({ where: { plan, active: true } });
    if (oldActive) {
      await tx.planPrice.update({
        where: { id: oldActive.id },
        data: { active: false, archivedAt: new Date() },
      });
    }

    const activated = await tx.planPrice.update({ where: { id: pendingId }, data: { active: true } });

    await writeAudit(tx, {
      actorType: 'admin',
      actorId,
      action: AUDIT_ACTIONS.planPriceChanged,
      targetType: 'plan_price',
      targetId: activated.id,
      before: oldActive ? { priceCents: oldActive.priceCents, stripePriceId: oldActive.stripePriceId } : null,
      after: { priceCents: activated.priceCents, stripePriceId: activated.stripePriceId },
      reason,
      ip,
    });

    return { oldActive, activated };
  });

  // Outside the transaction, after commit — invalidating mid-transaction
  // would let a concurrent read repopulate the cache with pre-commit data.
  invalidatePlanRegistry();

  // ── Step D — deferred, best-effort archive of the old Stripe price.
  // A failure here is cosmetic Stripe clutter, not a billing fault: it must
  // never roll back the DB state that already committed above. ────────────
  if (committed.oldActive?.stripePriceId) {
    try {
      await payments.archivePrice(committed.oldActive.stripePriceId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[plan-price] failed to archive old Stripe price ${committed.oldActive.stripePriceId} for "${plan}" ` +
          `(new active price ${priceId} already committed):`,
        err,
      );
    }
  }

  return {
    planPriceId: committed.activated.id,
    priceCents: committed.activated.priceCents,
    stripePriceId: committed.activated.stripePriceId!,
    previousPriceCents: committed.oldActive?.priceCents ?? null,
    previousStripePriceId: committed.oldActive?.stripePriceId ?? null,
  };
}
