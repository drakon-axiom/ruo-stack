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
    const volumeActive = await prisma.planPrice.findFirstOrThrow({ where: { plan: 'volume', active: true } });

    await expect(
      subscribeBrandToPaidPlan(
        { origin: undefined, ip: '127.0.0.1' },
        { brandId, userId: `u_${randomToken(6)}`, plan: 'pro', priceVersionId: volumeActive.id },
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
    const activeRow = await prisma.planPrice.findFirstOrThrow({ where: { plan: 'pro', active: true } });

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
