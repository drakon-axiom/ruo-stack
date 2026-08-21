import { getPrisma } from '@ruostack/db';
import { PAID_PLAN_KEYS, type PaidPlanKey } from '@ruostack/shared';
import { getClients } from '../clients.ts';

/**
 * Seeds `plan_price` (and `plan.stripe_product_id`) from Stripe — the moment
 * the new source of truth gets its initial values.
 *
 * THE PRICE COMES FROM STRIPE, NOT FROM ANY LOCAL CONSTANT. We take the price
 * id given on the command line, call `payments.retrievePrice()`, and write
 * exactly what Stripe returns. `HISTORICAL_DISPLAY_CENTS` below is checked
 * only to log a discrepancy — it is the symptom of the original bug (a price
 * constant that drifted from Stripe with no type error and no failing
 * test), not a source of truth. It is not exported from `@ruostack/shared`;
 * this script is its only reader.
 *
 * Idempotent — safe to re-run:
 *  - Paid tiers upsert on `plan_price.stripe_price_id` (unique). A second run
 *    that finds an already-active row for that price id makes no writes at all
 *    (leaves createdAt/id untouched).
 *  - Starter has no Stripe price (it's free) — see seedStarter() below for why
 *    it still gets a `plan_price` row.
 *
 * Price ids are CLI arguments, not env vars — this is a one-time bootstrap
 * operation (or a deliberate re-point), not ambient config something else
 * reads at boot. `apps/api/src/config.ts` has no `STRIPE_*_PRICE_ID` entries;
 * after the seed has run once, `plan_price` is the only source of truth and
 * this script's arguments are forgotten on purpose:
 *
 *   pnpm seed:plans --pro price_xxx --volume price_yyy
 *
 * See parsePriceIdArgs() below for the flag names, which are derived from
 * PAID_PLAN_KEYS rather than hardcoded.
 */

/**
 * The prices this project advertised before the plan registry existed —
 * kept only so this script can log a one-time discrepancy if the configured
 * Stripe price disagrees with what the portal used to display. Local and
 * unexported on purpose: nothing outside this file, and nothing at runtime,
 * may read a hardcoded plan price. `packages/shared` exports none.
 */
const HISTORICAL_DISPLAY_CENTS: Record<PaidPlanKey, number> = {
  pro: 4900,
  volume: 14900,
};

/**
 * Seeds one paid tier from an already-resolved Stripe price id. Split out from
 * `seedPlans()`'s argument parsing so integration tests can drive this
 * against a fake, test-scoped price id — proving the upsert/idempotency
 * behavior without colliding with (or depending on) whatever real price id
 * is passed to this script on the command line.
 */
export async function seedPaidPlan(tier: PaidPlanKey, priceId: string): Promise<void> {
  const { prisma, payments } = getClients();

  const retrieved = await payments.retrievePrice(priceId);

  // StripeAdapter.retrievePrice coerces a missing unit_amount to 0 (metered /
  // tiered / graduated prices have no single `unit_amount`). A paid tier can
  // never legitimately cost 0 — silently writing price_cents: 0, active: true
  // would make Pro or Volume free for every new signup. Refuse loudly instead
  // of writing it, same posture as the missing-argument guard in seedPlans().
  if (retrieved.unitAmountCents <= 0) {
    throw new Error(
      `[seed-plans] Refusing to seed "${tier}": Stripe price ${priceId} has unit_amount ${retrieved.unitAmountCents}c. ` +
        `This is almost certainly a metered/tiered/graduated price with no flat unit_amount (retrievePrice() coerces a ` +
        `missing unit_amount to 0) — seeding it would make a paid tier free. Point --${tier} at a standard recurring ` +
        `price with a fixed amount, or fix this check if that assumption is wrong.`,
    );
  }

  const displayCents = HISTORICAL_DISPLAY_CENTS[tier];
  if (displayCents !== retrieved.unitAmountCents) {
    console.warn(
      `[seed-plans] DISCREPANCY on "${tier}": the historical display price was ${displayCents}c but Stripe price ` +
        `${priceId} is ${retrieved.unitAmountCents}c. Writing the Stripe value — Stripe is billing truth.`,
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

/** e.g. `Usage: pnpm seed:plans --pro <stripe_price_id> --volume <stripe_price_id>` */
function usage(): string {
  const flags = PAID_PLAN_KEYS.map((tier) => `--${tier} <stripe_price_id>`).join(' ');
  return `Usage: pnpm seed:plans ${flags}`;
}

/**
 * Parses `--<tier> <stripe_price_id>` pairs off argv for every paid tier.
 * Flag names are derived from `PAID_PLAN_KEYS` — not hardcoded to `--pro` /
 * `--volume` — so a new paid tier automatically requires (and gets a usage
 * line for) its own flag here with nothing else to update.
 *
 * Fails loudly, before any Stripe call, on any problem a bad invocation can
 * have. A bootstrap script silently misreading its arguments is worse than
 * one that rejects them, so this rejects — rather than guesses at — every
 * shape it doesn't recognise:
 *  - a missing tier (would leave that tier with no active price —
 *    `plan_price_unconfigured` at checkout);
 *  - a malformed price id (a typo'd or transposed argument);
 *  - a repeated flag (`--pro a --pro b`) — `indexOf` would silently keep
 *    only the first occurrence, so a user "correcting" a typo by pasting a
 *    second `--pro` would silently seed the stale first value instead;
 *  - an unrecognised `--`-prefixed token — silently ignoring it would let a
 *    user believe an argument took effect when it did nothing;
 *  - the `--pro=price_x` equals form — not accepted (see below), rejected
 *    with a specific message rather than the generic "missing" one.
 * Never skips a tier silently.
 */
export function parsePriceIdArgs(argv: readonly string[]): Record<PaidPlanKey, string> {
  const knownFlags = new Set(PAID_PLAN_KEYS.map((tier) => `--${tier}`));
  const flagCounts = new Map<string, number>();

  // First pass: reject anything that isn't exactly one of the known flags in
  // the accepted space-separated form, before looking at any value.
  for (const token of argv) {
    if (!token.startsWith('--')) continue; // a value, not a flag
    const eq = token.indexOf('=');
    const flagPart = eq === -1 ? token : token.slice(0, eq);
    if (eq !== -1 && knownFlags.has(flagPart)) {
      // `--pro=price_x` looks intentional (the flag name is right there) but
      // isn't parsed — say so explicitly instead of reporting it as missing.
      throw new Error(
        `[seed-plans] "${flagPart}=..." is not supported — pass the value as a separate argument: ` +
          `${flagPart} <stripe_price_id>.\n${usage()}`,
      );
    }
    if (!knownFlags.has(token)) {
      throw new Error(`[seed-plans] Unrecognized argument "${token}".\n${usage()}`);
    }
    flagCounts.set(token, (flagCounts.get(token) ?? 0) + 1);
  }
  for (const [flag, count] of flagCounts) {
    if (count > 1) {
      throw new Error(`[seed-plans] ${flag} was passed ${count} times — pass each price id exactly once.\n${usage()}`);
    }
  }

  const priceIds = {} as Record<PaidPlanKey, string>;
  for (const tier of PAID_PLAN_KEYS) {
    const flag = `--${tier}`;
    const flagIndex = argv.indexOf(flag);
    if (flagIndex === -1) {
      throw new Error(`[seed-plans] Missing required argument ${flag} <stripe_price_id>.\n${usage()}`);
    }
    const value = argv[flagIndex + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`[seed-plans] ${flag} requires a value (a Stripe price id).\n${usage()}`);
    }
    // A Stripe price id always starts with "price_" — catch a typo'd or
    // transposed argument (e.g. the product id, or the two flags swapped)
    // here, before it ever reaches retrievePrice().
    if (!value.startsWith('price_')) {
      throw new Error(
        `[seed-plans] ${flag} "${value}" does not look like a Stripe price id (expected it to start with "price_").\n${usage()}`,
      );
    }
    priceIds[tier] = value;
  }
  return priceIds;
}

export async function seedPlans(argv: readonly string[]): Promise<void> {
  // Parse (and validate the shape of) every price id before writing anything,
  // including the free starter row — a bad invocation should fail before any
  // side effect, not partway through.
  const priceIds = parsePriceIdArgs(argv);
  await seedStarterPlan();
  for (const tier of PAID_PLAN_KEYS) {
    await seedPaidPlan(tier, priceIds[tier]);
  }
}

async function main() {
  await seedPlans(process.argv.slice(2));
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
