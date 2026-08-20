import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { PLANS } from '@ruostack/shared';
import type { RetrievedPrice } from '@ruostack/shared';
import { getClients, resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';
import { seedPaidPlan, seedStarterPlan } from '../../src/scripts/seed-plans.ts';
import { randomToken } from '../../src/crypto.ts';

// Proves Task 4's central rule: the seeded price comes from Stripe
// (payments.retrievePrice()), never from the plans.ts display constant. The
// fake is programmed to return an amount that deliberately differs from
// PLANS.pro.priceCents / PLANS.volume.priceCents so the assertions can tell
// the two apart — if the seed ever regressed to reading plans.ts, this test
// would fail. Runs against the real (shared) database; self-skips unless
// RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

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
  // Deliberately different from plans.ts (4900 / 14900) — the whole point.
  const FAKE_PRO_CENTS = 5137;
  const FAKE_VOLUME_CENTS = 15373;
  const FAKE_PRO_PRODUCT = `prod_seedtest_pro_${suffix}`;
  const FAKE_VOLUME_PRODUCT = `prod_seedtest_volume_${suffix}`;

  let fake: ProgrammablePaymentsAdapter;
  let originalProProduct: string | null;
  let originalVolumeProduct: string | null;
  let createdStarterId: string | null = null;

  beforeAll(async () => {
    expect(FAKE_PRO_CENTS).not.toBe(PLANS.pro.priceCents);
    expect(FAKE_VOLUME_CENTS).not.toBe(PLANS.volume.priceCents);

    const [pro, volume] = await Promise.all([
      prisma.plan.findUniqueOrThrow({ where: { key: 'pro' } }),
      prisma.plan.findUniqueOrThrow({ where: { key: 'volume' } }),
    ]);
    originalProProduct = pro.stripeProductId;
    originalVolumeProduct = volume.stripeProductId;

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
    setClientsForTest({ payments: fake });
  });

  afterAll(async () => {
    // Leave the DB exactly as this test found it — plan_price rows this test
    // created, and the plan.stripe_product_id values it overwrote.
    await prisma.planPrice.deleteMany({ where: { stripePriceId: { in: [FAKE_PRO_PRICE_ID, FAKE_VOLUME_PRICE_ID] } } });
    if (createdStarterId) {
      await prisma.planPrice.delete({ where: { id: createdStarterId } }).catch(() => undefined);
    }
    await prisma.plan.update({ where: { key: 'pro' }, data: { stripeProductId: originalProProduct } });
    await prisma.plan.update({ where: { key: 'volume' }, data: { stripeProductId: originalVolumeProduct } });
    resetClientsForTest();
    await prisma.$disconnect();
  });

  it('seeds price_cents from the payments adapter (Stripe), not from plans.ts', async () => {
    await seedPaidPlan('pro', FAKE_PRO_PRICE_ID);

    const row = await prisma.planPrice.findUnique({ where: { stripePriceId: FAKE_PRO_PRICE_ID } });
    expect(row).not.toBeNull();
    expect(row!.priceCents).toBe(FAKE_PRO_CENTS);
    expect(row!.priceCents).not.toBe(PLANS.pro.priceCents); // the assertion that proves the rule
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
    expect(row!.priceCents).not.toBe(PLANS.volume.priceCents);
    expect(row!.active).toBe(true);

    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: 'volume' } });
    expect(plan.stripeProductId).toBe(FAKE_VOLUME_PRODUCT);
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
