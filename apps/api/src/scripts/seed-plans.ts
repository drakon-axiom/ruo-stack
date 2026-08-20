import { getPrisma } from '@ruostack/db';
import { PLANS, PAID_PLAN_KEYS, type PaidPlanKey } from '@ruostack/shared';
import { loadConfig } from '../config.ts';
import { getClients } from '../clients.ts';

/**
 * Seeds `plan_price` (and `plan.stripe_product_id`) from Stripe — the moment
 * the new source of truth gets its initial values.
 *
 * THE PRICE COMES FROM STRIPE, NOT FROM plans.ts. `plans.ts#PLANS[tier].priceCents`
 * is a display constant that has drifted from Stripe before (that drift is the bug
 * this migration closes); only Stripe actually charges anyone. We read the
 * configured price id, call `payments.retrievePrice()`, and write exactly what
 * Stripe returns. Any disagreement with `plans.ts` is logged loudly — it is the
 * symptom, not noise.
 *
 * Idempotent — safe to re-run:
 *  - Paid tiers upsert on `plan_price.stripe_price_id` (unique). A second run
 *    that finds an already-active row for that price id makes no writes at all
 *    (leaves createdAt/id untouched).
 *  - Starter has no Stripe price (it's free) — see seedStarter() below for why
 *    it still gets a `plan_price` row.
 *
 * Env: STRIPE_PRO_PRICE_ID, STRIPE_VOLUME_PRICE_ID (apps/api/src/config.ts).
 */

const PRICE_ID_ENV: Record<PaidPlanKey, 'STRIPE_PRO_PRICE_ID' | 'STRIPE_VOLUME_PRICE_ID'> = {
  pro: 'STRIPE_PRO_PRICE_ID',
  volume: 'STRIPE_VOLUME_PRICE_ID',
};

/**
 * Seeds one paid tier from an already-resolved Stripe price id. Split out from
 * `seedPlans()`'s env lookup so integration tests can drive this against a
 * fake, test-scoped price id — proving the upsert/idempotency behavior
 * without colliding with (or depending on) the real `STRIPE_*_PRICE_ID`
 * configured in this environment.
 */
export async function seedPaidPlan(tier: PaidPlanKey, priceId: string): Promise<void> {
  const { prisma, payments } = getClients();

  const retrieved = await payments.retrievePrice(priceId);

  const displayCents = PLANS[tier].priceCents;
  if (displayCents !== retrieved.unitAmountCents) {
    console.warn(
      `[seed-plans] DISCREPANCY on "${tier}": plans.ts says ${displayCents}c but Stripe price ${priceId} ` +
        `is ${retrieved.unitAmountCents}c. Writing the Stripe value — plans.ts is a display constant, not billing truth.`,
    );
  }
  if (!retrieved.active) {
    console.warn(`[seed-plans] Stripe price ${priceId} for "${tier}" is INACTIVE. Seeding it anyway — check Stripe.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.plan.update({
      where: { key: tier },
      data: { stripeProductId: retrieved.productId },
    });

    const existing = await tx.planPrice.findUnique({ where: { stripePriceId: priceId } });
    if (existing) {
      if (existing.active) {
        // Already the live row for this exact Stripe price. Nothing to do —
        // re-running must not touch an already-correct active row.
        console.log(`[seed-plans] "${tier}": plan_price for ${priceId} already active (${existing.priceCents}c) — no-op.`);
        return;
      }
      // Exists but was archived (e.g. a prior rotation) — reactivate it.
      await tx.planPrice.updateMany({
        where: { plan: tier, active: true },
        data: { active: false, archivedAt: new Date() },
      });
      await tx.planPrice.update({ where: { id: existing.id }, data: { active: true, archivedAt: null } });
      console.log(`[seed-plans] "${tier}": reactivated existing plan_price for ${priceId} (${existing.priceCents}c).`);
      return;
    }

    // No row for this Stripe price id yet — deactivate whatever else is live
    // for this tier (there shouldn't be anything on a first run) and insert.
    await tx.planPrice.updateMany({
      where: { plan: tier, active: true },
      data: { active: false, archivedAt: new Date() },
    });
    const created = await tx.planPrice.create({
      data: {
        plan: tier,
        priceCents: retrieved.unitAmountCents,
        stripePriceId: priceId,
        active: true,
      },
    });
    console.log(
      `[seed-plans] "${tier}": seeded plan_price ${created.id} = ${retrieved.unitAmountCents}c ` +
        `(stripe_price_id=${priceId}, product=${retrieved.productId}).`,
    );
  });
}

/**
 * Starter is free and has no Stripe price — the CHECK constraint requires
 * `price_cents = 0 AND stripe_price_id IS NULL` for its rows. It still gets an
 * ACTIVE plan_price row (permitted by the constraint) rather than being left
 * with none, so that:
 *  - Task 5's registry can read "the active price for every tier" with one
 *    uniform query instead of special-casing starter as priceless.
 *  - Task 7's quote flow always has a `price_version_id` to stamp — even a
 *    free-plan quote — instead of needing a null-token branch through billing.
 * `plan.stripe_product_id` stays NULL for starter: there is no Stripe product
 * to point at.
 */
export async function seedStarterPlan(): Promise<void> {
  const { prisma } = getClients();
  const existing = await prisma.planPrice.findFirst({ where: { plan: 'starter', active: true } });
  if (existing) {
    console.log(`[seed-plans] "starter": plan_price ${existing.id} already active (0c) — no-op.`);
    return;
  }
  const created = await prisma.planPrice.create({
    data: { plan: 'starter', priceCents: 0, stripePriceId: null, active: true },
  });
  console.log(`[seed-plans] "starter": seeded plan_price ${created.id} = 0c (free, no Stripe price).`);
}

export async function seedPlans(): Promise<void> {
  await seedStarterPlan();
  const cfg = loadConfig();
  for (const tier of PAID_PLAN_KEYS) {
    const priceId = cfg[PRICE_ID_ENV[tier]];
    if (!priceId) {
      throw new Error(`${PRICE_ID_ENV[tier]} is not set — cannot seed the "${tier}" plan price.`);
    }
    await seedPaidPlan(tier, priceId);
  }
}

async function main() {
  await seedPlans();
}

// Only run as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    })
    .finally(async () => {
      await getPrisma().$disconnect();
    });
}
