import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { PLAN_KEYS } from '@ruostack/shared';
import { getClients } from '../../src/clients.ts';
import { planAllowsStore, storeConnectionsUpsellForBrand } from '../../src/routes/brand-store.ts';
import { getPlanRegistry, storeConnectionsUpsellMessage } from '../../src/services/plan-registry.ts';
import { randomToken } from '../../src/crypto.ts';

/**
 * `GET /api/brand/store`'s `upsell` field (added alongside the pre-existing
 * `plan_allows`) — null when the brand's plan already allows store
 * connections, otherwise the same registry-derived message
 * `brand-store.ts`'s 403s use (see `storeConnectionsUpsellMessage`'s own
 * unit tests in `plan-registry.test.ts`).
 *
 * `planAllowsStore` / `storeConnectionsUpsellForBrand` are exported at module
 * level specifically so this suite can call them directly with a real
 * brandId — brand routes carry Supabase-minted JWTs no test can forge, so
 * `GET /api/brand/store` itself can't be driven over HTTP here (same
 * constraint documented in brand-subscribe-quote.test.ts).
 *
 * HARD RULE: only ever INSERTS new, throwaway rows (a brand + optional
 * subscriptionState per test). Never touches any EXISTING plan/plan_price/
 * subscription_state row, so there is nothing to snapshot/restore — only to
 * delete in afterAll. Self-skips unless RUN_DB_TESTS=1.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('brand store upsell field (DB integration, service-level)', () => {
  const brandIds: string[] = [];

  async function makeBrand(name: string): Promise<string> {
    const brand = await prisma.brand.create({ data: { brandName: name, referralCode: `SU-${randomToken(6)}` } });
    brandIds.push(brand.id);
    return brand.id;
  }

  afterAll(async () => {
    // NOT wrapped in .catch(() => undefined): two of the three tests below
    // insert subscription_state rows into a live shared database whose
    // required baseline is zero rows. A silently swallowed delete here would
    // leak them permanently with no test failure to signal it.
    await prisma.subscriptionState.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  it('is null for a brand on a plan that allows store connections (active pro)', async () => {
    const brandId = await makeBrand('Upsell Pro Co');
    await prisma.subscriptionState.create({
      data: { brandId, plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });

    expect(await planAllowsStore(brandId)).toBe(true);
    expect(await storeConnectionsUpsellForBrand(brandId)).toBeNull();
  });

  it('is the registry-derived message for a brand with no subscription (effective starter)', async () => {
    const brandId = await makeBrand('Upsell Starter Co');
    // No subscriptionState row at all — effectivePlan(null) is 'starter'.

    expect(await planAllowsStore(brandId)).toBe(false);

    const { prisma: p } = getClients();
    const registry = await getPlanRegistry(p);
    const expected = storeConnectionsUpsellMessage(registry);

    const upsell = await storeConnectionsUpsellForBrand(brandId);
    expect(upsell).toBe(expected);
    // Sanity: the message names at least the tiers the live registry says
    // carry storeConnections, whatever they're currently called.
    for (const key of PLAN_KEYS) {
      if (registry[key].capabilities.storeConnections) expect(upsell).toContain(registry[key].name);
    }
  });

  it('is null for a past_due brand (dunning grace still grants the paid tier)', async () => {
    const brandId = await makeBrand('Upsell PastDue Co');
    await prisma.subscriptionState.create({
      data: { brandId, plan: 'volume', status: 'past_due', currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000) },
    });

    expect(await storeConnectionsUpsellForBrand(brandId)).toBeNull();
  });
});
