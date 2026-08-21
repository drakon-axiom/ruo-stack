import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { getClients, resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';
import { subscribeBrandToPaidPlan } from '../../src/routes/brand-billing.ts';
import { randomToken } from '../../src/crypto.ts';

/**
 * The checkout quote-token rail (Task 7): `POST /api/brand/billing/subscribe`
 * must refuse a stale `price_version_id` — and must not touch Stripe at all
 * while refusing it — and must resolve the Stripe price id straight off the
 * `plan_price` row the token names, not off `cfg.STRIPE_PRO_PRICE_ID` or the
 * (possibly up-to-60s-stale) registry cache.
 *
 * Brand routes carry Supabase-minted JWTs no test can forge (see
 * clients.ts's setClientsForTest doc comment), so this exercises
 * `subscribeBrandToPaidPlan` directly — the function the route handler
 * calls — with a FakePaymentsAdapter swapped in, rather than app.inject.
 *
 * HARD RULE: only ever INSERTS new, throwaway rows (a brand per test, and —
 * for the staleness test — an inactive plan_price row this suite creates
 * itself). Never mutates or deactivates any EXISTING plan_price row, so
 * there is nothing to restore for the live pro/volume active rows; only to
 * delete in afterAll. Self-skips unless RUN_DB_TESTS=1.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('brand subscribe quote-token check (DB integration, service-level)', () => {
  let fake: FakePaymentsAdapter;
  const brandIds: string[] = [];
  const planPriceIds: string[] = [];

  async function makeBrand(name: string): Promise<string> {
    const brand = await prisma.brand.create({ data: { brandName: name, referralCode: `QT-${randomToken(6)}` } });
    brandIds.push(brand.id);
    return brand.id;
  }

  beforeAll(() => {
    fake = new FakePaymentsAdapter();
    setClientsForTest({ payments: fake });
  });

  afterAll(async () => {
    await prisma.subscriptionState.deleteMany({ where: { brandId: { in: brandIds } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { targetType: 'brand', targetId: { in: brandIds } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } }).catch(() => undefined);
    await prisma.planPrice.deleteMany({ where: { id: { in: planPriceIds } } }).catch(() => undefined);
    resetClientsForTest();
    await prisma.$disconnect();
  });

  it('rejects a stale (inactive) price_version_id with price_changed, and makes NO Stripe call', async () => {
    const brandId = await makeBrand('Stale Quote Co');
    // A row that WAS live for "pro" and has since been archived by a
    // reprice — the exact shape a stale quote token points at. Inactive, so
    // stripe_price_id may legally be null under plan_price_starter_free_ck.
    const stale = await prisma.planPrice.create({
      data: { plan: 'pro', priceCents: 4900, stripePriceId: null, active: false, archivedAt: new Date() },
    });
    planPriceIds.push(stale.id);

    const callsBefore = fake.calls.length;
    await expect(
      subscribeBrandToPaidPlan(
        { origin: 'https://brand.test', ip: '127.0.0.1' },
        { brandId, userId: `u_${randomToken(6)}`, plan: 'pro', priceVersionId: stale.id },
      ),
    ).rejects.toMatchObject({ code: 'price_changed', statusCode: 409 });

    // Zero Stripe calls — the check runs before ensureCustomer, which is
    // itself capable of calling Stripe (createCustomer) on first subscribe.
    expect(fake.calls.length).toBe(callsBefore);
    expect(fake.callsFor('createCustomer')).toHaveLength(0);
    expect(fake.callsFor('createSubscriptionCheckout')).toHaveLength(0);
  });

  it('rejects a price_version_id that belongs to a different plan than requested', async () => {
    const brandId = await makeBrand('Wrong Plan Co');
    // The guard at brand-billing.ts:124 is a single OR: `!priceRow ||
    // priceRow.plan !== input.plan || !priceRow.active`. For this test to
    // prove the MIDDLE clause specifically, the row must be ACTIVE — an
    // inactive row would also trip the `!active` clause and the test would
    // pass even if the plan-mismatch check were deleted entirely. Same
    // conditional-seed pattern as the "succeeds" test below: use the real
    // active "volume" row if one exists, otherwise seed a throwaway active
    // one (CHECK-legal: non-starter with a non-null stripe_price_id;
    // index-safe: only created when no active row already exists).
    let wrongPlanRow = await prisma.planPrice.findFirst({ where: { plan: 'volume', active: true } });
    if (!wrongPlanRow) {
      wrongPlanRow = await prisma.planPrice.create({
        data: { plan: 'volume', priceCents: 14900, stripePriceId: `price_fixture_wrongplan_${randomToken(6)}`, active: true },
      });
      planPriceIds.push(wrongPlanRow.id);
    }

    await expect(
      subscribeBrandToPaidPlan(
        { origin: undefined, ip: '127.0.0.1' },
        { brandId, userId: `u_${randomToken(6)}`, plan: 'pro', priceVersionId: wrongPlanRow.id },
      ),
    ).rejects.toMatchObject({ code: 'price_changed' });

    expect(fake.callsFor('createSubscriptionCheckout')).toHaveLength(0);
  });

  it('rejects an unknown / nonexistent price_version_id', async () => {
    const brandId = await makeBrand('Unknown Token Co');
    await expect(
      subscribeBrandToPaidPlan(
        { origin: undefined, ip: '127.0.0.1' },
        { brandId, userId: `u_${randomToken(6)}`, plan: 'pro', priceVersionId: '00000000-0000-0000-0000-000000000000' },
      ),
    ).rejects.toMatchObject({ code: 'price_changed' });
  });

  it('a current price_version_id succeeds and resolves the Stripe price id from that SAME row (not cfg env, not the registry)', async () => {
    const brandId = await makeBrand('Current Quote Co');
    // Use the real active "pro" row if one exists. On an empty plan_price
    // table (CI: migration 030 deliberately leaves it empty, and ci.yml
    // never runs seed:plans) there is none — seed a throwaway active row for
    // this test alone, tracked in planPriceIds for the same cleanup every
    // other row this suite creates gets. Never touches an existing active
    // row (this suite's hard rule: only ever inserts new, throwaway rows).
    let activeRow = await prisma.planPrice.findFirst({ where: { plan: 'pro', active: true } });
    if (!activeRow) {
      activeRow = await prisma.planPrice.create({
        data: { plan: 'pro', priceCents: 4900, stripePriceId: `price_fixture_quote_${randomToken(6)}`, active: true },
      });
      planPriceIds.push(activeRow.id);
    }

    const result = await subscribeBrandToPaidPlan(
      { origin: 'https://brand.test', ip: '127.0.0.1' },
      { brandId, userId: `u_${randomToken(6)}`, plan: 'pro', priceVersionId: activeRow.id },
    );

    expect(result.url).toMatch(/^https:\/\/fake\.test\/checkout\//);
    const checkoutCalls = fake.callsFor('createSubscriptionCheckout');
    expect(checkoutCalls).toHaveLength(1);
    const args = checkoutCalls[0]!.args[0] as { priceId: string; brandId: string };
    expect(args.priceId).toBe(activeRow.stripePriceId);
    expect(args.brandId).toBe(brandId);

    // Also created the Stripe customer this time — a live token means the
    // full flow runs, unlike the stale-token tests above.
    expect(fake.callsFor('createCustomer')).toHaveLength(1);

    const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
    expect(brand.stripeCustomerId).not.toBeNull();
  });

  it('getClients() is actually wired to the fake (sanity on the injection seam)', () => {
    expect(getClients().payments).toBe(fake);
  });
});
