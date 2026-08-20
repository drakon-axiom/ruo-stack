import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import type { RetrievedPrice } from '@ruostack/shared';
import { getClients, resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';
import { seedPaidPlan, seedStarterPlan } from '../../src/scripts/seed-plans.ts';
import { randomToken } from '../../src/crypto.ts';

// Proves Task 4's central rule: the seeded price comes from Stripe
// (payments.retrievePrice()), never from any local display constant. The
// fake is programmed to return an amount that deliberately differs from
// seed-plans.ts's private, unexported HISTORICAL_DISPLAY_CENTS (4900 / 14900
// — mirrored below since that constant isn't exported for a test to import;
// `@ruostack/shared` exports no plan price at all) so the assertions can
// tell the two apart — if the seed ever regressed to reading a hardcoded
// display price, this test would fail. Runs against the real (shared)
// database; self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();
// Mirrors seed-plans.ts's private HISTORICAL_DISPLAY_CENTS — kept in sync by
// hand since that constant is deliberately not exported (see comment above).
const HISTORICAL_DISPLAY_CENTS = { pro: 4900, volume: 14900 } as const;

/** Programmable fake: retrievePrice() answers from a map keyed by price id,
 *  instead of FakePaymentsAdapter's fixed always-0 stub. */
class ProgrammablePaymentsAdapter extends FakePaymentsAdapter {
  private readonly priceById = new Map<string, RetrievedPrice>();

  programPrice(priceId: string, price: RetrievedPrice): void {
    this.priceById.set(priceId, price);
  }

  override async retrievePrice(priceId: string): Promise<RetrievedPrice> {
    this.calls.push({ method: 'retrievePrice', args: [priceId] });
    const price = this.priceById.get(priceId);
    if (!price) throw new Error(`ProgrammablePaymentsAdapter: no price programmed for ${priceId}`);
    return price;
  }
}

describe.skipIf(!RUN)('seed-plans (DB integration)', () => {
  const suffix = randomToken(6);
  const FAKE_PRO_PRICE_ID = `price_seedtest_pro_${suffix}`;
  const FAKE_VOLUME_PRICE_ID = `price_seedtest_volume_${suffix}`;
  // Deliberately different from HISTORICAL_DISPLAY_CENTS (4900 / 14900) — the whole point.
  const FAKE_PRO_CENTS = 5137;
  const FAKE_VOLUME_CENTS = 15373;
  const FAKE_PRO_PRODUCT = `prod_seedtest_pro_${suffix}`;
  const FAKE_VOLUME_PRODUCT = `prod_seedtest_volume_${suffix}`;
  // A metered/tiered/graduated Stripe price has no flat unit_amount;
  // retrievePrice() coerces that missing value to 0 (stripe-adapter.ts).
  const FAKE_ZERO_PRICE_ID = `price_seedtest_zero_${suffix}`;

  let fake: ProgrammablePaymentsAdapter;
  let originalProProduct: string | null;
  let originalVolumeProduct: string | null;
  let createdStarterId: string | null = null;
  // Whatever plan_price row was live for pro/volume before this suite ran —
  // seedPaidPlan's "no existing row for this stripe_price_id" branch
  // deactivates the tier's current active row before inserting the new one,
  // so a fake-priced test run clobbers the real production row unless it is
  // put back. null on an empty database (nothing to restore).
  let originalProActive: { id: string; priceCents: number; stripePriceId: string | null } | null;
  let originalVolumeActive: { id: string; priceCents: number; stripePriceId: string | null } | null;

  beforeAll(async () => {
    expect(FAKE_PRO_CENTS).not.toBe(HISTORICAL_DISPLAY_CENTS.pro);
    expect(FAKE_VOLUME_CENTS).not.toBe(HISTORICAL_DISPLAY_CENTS.volume);

    const [pro, volume] = await Promise.all([
      prisma.plan.findUniqueOrThrow({ where: { key: 'pro' } }),
      prisma.plan.findUniqueOrThrow({ where: { key: 'volume' } }),
    ]);
    originalProProduct = pro.stripeProductId;
    originalVolumeProduct = volume.stripeProductId;

    const [proActive, volumeActive] = await Promise.all([
      prisma.planPrice.findFirst({ where: { plan: 'pro', active: true } }),
      prisma.planPrice.findFirst({ where: { plan: 'volume', active: true } }),
    ]);
    originalProActive = proActive
      ? { id: proActive.id, priceCents: proActive.priceCents, stripePriceId: proActive.stripePriceId }
      : null;
    originalVolumeActive = volumeActive
      ? { id: volumeActive.id, priceCents: volumeActive.priceCents, stripePriceId: volumeActive.stripePriceId }
      : null;

    fake = new ProgrammablePaymentsAdapter();
    fake.programPrice(FAKE_PRO_PRICE_ID, {
      productId: FAKE_PRO_PRODUCT,
      unitAmountCents: FAKE_PRO_CENTS,
      currency: 'usd',
      interval: 'month',
      active: true,
    });
    fake.programPrice(FAKE_VOLUME_PRICE_ID, {
      productId: FAKE_VOLUME_PRODUCT,
      unitAmountCents: FAKE_VOLUME_CENTS,
      currency: 'usd',
      interval: 'month',
      active: true,
    });
    fake.programPrice(FAKE_ZERO_PRICE_ID, {
      productId: `prod_seedtest_zero_${suffix}`,
      unitAmountCents: 0,
      currency: 'usd',
      interval: 'month',
      active: true,
    });
    setClientsForTest({ payments: fake });
  });

  afterAll(async () => {
    // Leave the DB exactly as this test found it — plan_price rows this test
    // created, the active row it deactivated, and the plan.stripe_product_id
    // values it overwrote.
    await prisma.planPrice.deleteMany({ where: { stripePriceId: { in: [FAKE_PRO_PRICE_ID, FAKE_VOLUME_PRICE_ID] } } });
    if (createdStarterId) {
      await prisma.planPrice.delete({ where: { id: createdStarterId } }).catch(() => undefined);
    }
    // Reactivate whatever was live before this suite ran, if anything — the
    // "no existing row for this stripe_price_id" branch in seedPaidPlan
    // deactivates the tier's prior active row, so restoring stripe_product_id
    // alone is not enough: without this, pro/volume are left with ZERO active
    // plan_price rows (plan_price_unconfigured) after this suite runs against
    // a populated database. Deliberately outside any transaction with the
    // deletes above — this must still run and be visible even if an earlier
    // cleanup step throws.
    if (originalProActive) {
      await prisma.planPrice.update({ where: { id: originalProActive.id }, data: { active: true, archivedAt: null } });
    }
    if (originalVolumeActive) {
      await prisma.planPrice.update({ where: { id: originalVolumeActive.id }, data: { active: true, archivedAt: null } });
    }
    await prisma.plan.update({ where: { key: 'pro' }, data: { stripeProductId: originalProProduct } });
    await prisma.plan.update({ where: { key: 'volume' }, data: { stripeProductId: originalVolumeProduct } });
    resetClientsForTest();
    await prisma.$disconnect();
  });

  it('seeds price_cents from the payments adapter (Stripe), not from a local display constant', async () => {
    await seedPaidPlan('pro', FAKE_PRO_PRICE_ID);

    const row = await prisma.planPrice.findUnique({ where: { stripePriceId: FAKE_PRO_PRICE_ID } });
    expect(row).not.toBeNull();
    expect(row!.priceCents).toBe(FAKE_PRO_CENTS);
    expect(row!.priceCents).not.toBe(HISTORICAL_DISPLAY_CENTS.pro); // the assertion that proves the rule
    expect(row!.active).toBe(true);
    expect(row!.plan).toBe('pro');

    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: 'pro' } });
    expect(plan.stripeProductId).toBe(FAKE_PRO_PRODUCT);
  });

  it('seeds volume the same way', async () => {
    await seedPaidPlan('volume', FAKE_VOLUME_PRICE_ID);

    const row = await prisma.planPrice.findUnique({ where: { stripePriceId: FAKE_VOLUME_PRICE_ID } });
    expect(row).not.toBeNull();
    expect(row!.priceCents).toBe(FAKE_VOLUME_CENTS);
    expect(row!.priceCents).not.toBe(HISTORICAL_DISPLAY_CENTS.volume);
    expect(row!.active).toBe(true);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: 'volume' } });
    expect(plan.stripeProductId).toBe(FAKE_VOLUME_PRODUCT);
  });

  it('refuses to seed a paid tier at 0 cents instead of silently making it free', async () => {
    await expect(seedPaidPlan('pro', FAKE_ZERO_PRICE_ID)).rejects.toThrow(/Refusing to seed "pro"/);

    // No plan_price row written for the rejected price id...
    const row = await prisma.planPrice.findUnique({ where: { stripePriceId: FAKE_ZERO_PRICE_ID } });
    expect(row).toBeNull();
    // ...and no side effect on plan.stripe_product_id either — the guard
    // fires before the transaction that would write it.
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: 'pro' } });
    expect(plan.stripeProductId).not.toBe(`prod_seedtest_zero_${suffix}`);
  });

  it('re-running is idempotent: no duplicate row, active row left unchanged', async () => {
    const before = await prisma.planPrice.findUniqueOrThrow({ where: { stripePriceId: FAKE_PRO_PRICE_ID } });

    await seedPaidPlan('pro', FAKE_PRO_PRICE_ID);
    await seedPaidPlan('pro', FAKE_PRO_PRICE_ID); // twice, for good measure

    const rows = await prisma.planPrice.findMany({ where: { stripePriceId: FAKE_PRO_PRICE_ID } });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.id).toBe(before.id);
    expect(row!.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(row!.active).toBe(true);
    expect(row!.priceCents).toBe(FAKE_PRO_CENTS);

    // Exactly one active row for the tier — the partial unique index held.
    const active = await prisma.planPrice.findMany({ where: { plan: 'pro', active: true } });
    expect(active).toHaveLength(1);
  });

  it('seedStarterPlan seeds a free, priceless, active row and is idempotent', async () => {
    // starter's plan_price starts empty in a fresh environment, but this
    // suite may run after another pass — tolerate either by tracking what
    // (if anything) this call itself creates, for symmetric cleanup.
    const before = await prisma.planPrice.findFirst({ where: { plan: 'starter', active: true } });

    await seedStarterPlan();
    const first = await prisma.planPrice.findFirstOrThrow({ where: { plan: 'starter', active: true } });
    if (!before) createdStarterId = first.id;

    expect(first.priceCents).toBe(0);
    expect(first.stripePriceId).toBeNull();
    expect(first.active).toBe(true);

    await seedStarterPlan(); // idempotent
    const rows = await prisma.planPrice.findMany({ where: { plan: 'starter', active: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first.id);
  });

  it('getClients() is actually wired to the fake (sanity on the injection seam)', () => {
    expect(getClients().payments).toBe(fake);
  });
});
