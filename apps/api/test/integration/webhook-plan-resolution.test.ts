import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import type { NormalizedEvent } from '@ruostack/shared';
import { dispatchStripeEvent } from '../../src/routes/webhook.ts';
import { randomToken } from '../../src/crypto.ts';

/**
 * webhook.ts's price → tier resolution, against a real DB. Two things the
 * old env-var comparison (`priceId === cfg.STRIPE_VOLUME_PRICE_ID`) could
 * never do, and the bug it caused:
 *
 * 1. Resolve a price that has since been archived — a brand still
 *    subscribed on last quarter's price must still resolve to its tier
 *    forever, because `plan_price` is an append-only, permanent index.
 * 2. Refuse to invent a tier for a price it doesn't recognize. Previously
 *    `planForPrice()` returned `undefined` for anything unmapped, and
 *    `upsertSubscriptionState`'s CREATE path silently defaulted that to
 *    `'pro'` — a brand-new subscription on an unrecognized price got
 *    booked, and billed wholesale, as Pro. That must now throw instead.
 *
 * Only INSERTS new rows (a throwaway brand, a throwaway archived
 * plan_price, and — for the first test only — a throwaway subscription_state
 * row); never mutates an existing row, so there is nothing to snapshot —
 * only to delete in afterAll. Self-skips unless RUN_DB_TESTS=1.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

const brandIds: string[] = [];
const planPriceIds: string[] = [];

async function makeBrand(name: string): Promise<string> {
  const brand = await prisma.brand.create({ data: { brandName: name, referralCode: `WH-${randomToken(5)}` } });
  brandIds.push(brand.id);
  return brand.id;
}

describe.skipIf(!RUN)('webhook plan-tier resolution (DB integration)', () => {
  afterAll(async () => {
    await prisma.subscriptionState.deleteMany({ where: { brandId: { in: brandIds } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } }).catch(() => undefined);
    await prisma.planPrice.deleteMany({ where: { id: { in: planPriceIds } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('resolves an ARCHIVED price id to its tier — the historical-price case the env comparison could not handle', async () => {
    const suffix = randomToken(6);
    const archivedPriceId = `price_webhooktest_archived_${suffix}`;

    const archived = await prisma.planPrice.create({
      data: {
        plan: 'volume',
        priceCents: 14900,
        stripePriceId: archivedPriceId,
        active: false,
        archivedAt: new Date(),
      },
    });
    planPriceIds.push(archived.id);

    const brandId = await makeBrand('Historical Price Co');

    const event: NormalizedEvent = {
      kind: 'subscription.activated',
      externalId: `evt_${randomToken(8)}`,
      subscriptionId: `sub_${randomToken(8)}`,
      brandId,
      priceId: archivedPriceId,
      price: 14900,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86_400,
      cancelAtPeriodEnd: false,
    };

    // Fails before the fix: the old planForPrice() only ever compared against
    // the two currently-configured env price ids, so an archived price (one
    // that has since rotated out) resolved to undefined, and the CREATE path
    // silently defaulted the brand to 'pro' instead of 'volume'.
    await dispatchStripeEvent(prisma, event, '127.0.0.1');

    const state = await prisma.subscriptionState.findUnique({ where: { brandId } });
    expect(state).not.toBeNull();
    expect(state!.plan).toBe('volume');
    expect(state!.status).toBe('active');
  });

  it('an unknown price id on a brand with no existing SubscriptionState throws instead of defaulting to pro, and creates no row', async () => {
    const brandId = await makeBrand('Unknown Price Co');
    const unknownPriceId = `price_webhooktest_unknown_${randomToken(6)}`;

    const event: NormalizedEvent = {
      kind: 'subscription.activated',
      externalId: `evt_${randomToken(8)}`,
      subscriptionId: `sub_${randomToken(8)}`,
      brandId,
      priceId: unknownPriceId,
      price: 4900,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86_400,
      cancelAtPeriodEnd: false,
    };

    // This is the regression test for the bug itself: `plan: u.plan ?? 'pro'`
    // used to make this a silent, successful `resolve()` that booked the
    // brand as Pro. It must now throw and leave no trace.
    await expect(dispatchStripeEvent(prisma, event, '127.0.0.1')).rejects.toThrow(/no plan tier was resolved/);

    const state = await prisma.subscriptionState.findUnique({ where: { brandId } });
    expect(state).toBeNull();
  });
});
