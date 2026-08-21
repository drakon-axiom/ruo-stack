import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@ruostack/db';
import { getPrisma } from '@ruostack/db';
import { PLAN_KEYS } from '@ruostack/shared';
import { getPlanRegistry, invalidatePlanRegistry, storeConnectionsUpsellMessage, type ResolvedPlan } from '../../src/services/plan-registry.ts';
import { buyablePlanCatalog } from '../../src/routes/brand-billing.ts';

// Mirrors seed-plans.ts's private, unexported HISTORICAL_DISPLAY_CENTS
// (4900 for Pro) — kept in sync by hand since that constant is deliberately
// not exported. `@ruostack/shared` exports no plan price at all; this is
// only a fixed literal for the "disagrees with the historical display
// price" test below to compare against.
const HISTORICAL_PRO_DISPLAY_CENTS = 4900;

/**
 * plan-registry.ts is the switchover: every backend consumer that used to
 * read the `PLANS` constant (since retired — plans.ts now exports no price
 * data at all) now awaits `getPlanRegistry(db)`. Three groups
 * of tests here:
 *
 * 1. Unit tests against a synthetic, in-memory `plan.findMany` — no real DB
 *    write, so no snapshot/restore is needed. These prove the registry's own
 *    contract: throws on a missing tier, never fabricates a price for an
 *    unconfigured paid plan, resolves prices that disagree with the
 *    historical display price (proving there's no fallback to it), the
 *    memoization/stampede-guard/
 *    invalidation behaviour, that the resolved data is frozen, and that a
 *    transaction-shaped client never pollutes the process-wide cache.
 * 2. `buyablePlanCatalog` (brand-billing.ts) — the presentation-boundary
 *    filter that keeps an unconfigured paid tier off the wire instead of
 *    rendering a live $0 purchase card.
 * 3. One DB-integration test (RUN_DB_TESTS=1) proving the exact invariant
 *    the original bug violated: the price a plan card displays and the
 *    price/stripe_price_id Checkout would charge come from the SAME active
 *    plan_price row. Strictly READ-ONLY against `plan`/`plan_price` — it
 *    never writes to either table, so the "snapshot in beforeAll, restore in
 *    afterAll" rule for mutating tests does not apply here (there is nothing
 *    to restore).
 */

type FakeRow = {
  key: string;
  name: string;
  features: string[];
  storeConnections: boolean;
  maxOrdersPerMonth: number | null;
  shipping: 'flat' | 'live';
  shippingCutoff: string;
  prices: { priceCents: number; stripePriceId: string | null }[];
};

function fakeRow(overrides: Partial<FakeRow> & Pick<FakeRow, 'key'>): FakeRow {
  return {
    name: overrides.key,
    features: [],
    storeConnections: false,
    maxOrdersPerMonth: null,
    shipping: 'flat',
    shippingCutoff: '10 AM CST',
    prices: [{ priceCents: 0, stripePriceId: null }],
    ...overrides,
  };
}

/** Builds a minimal fake DB whose `plan.findMany` answers from a fixed row
 *  set (ignoring the `include`/`where` shape callers pass, exactly like the
 *  real query would apply it) and counts how many times it was called.
 *  Deliberately carries a `$transaction` stub so `isTransactionClient()`
 *  classifies it as a normal (cacheable) client, same as the real
 *  PrismaClient — without this, every synthetic fake here would look like a
 *  Prisma interactive-transaction client (which also lacks `$transaction`)
 *  and the memoization/stampede tests below would silently stop caching. */
function fakeDbFrom(rows: FakeRow[]): { db: PrismaClient; callCount: () => number } {
  let calls = 0;
  const db = {
    plan: {
      findMany: async () => {
        calls++;
        return rows;
      },
    },
    $transaction: async () => undefined,
  } as unknown as PrismaClient;
  return { db, callCount: () => calls };
}

/** A client shaped like the one Prisma hands into `db.$transaction(async (tx)
 *  => ...)` — no `$transaction` of its own (Prisma's `ITXClientDenyList`
 *  strips it, along with `$connect`/`$disconnect`/`$on`/`$extends`, off the
 *  callback client). Used to prove getPlanRegistry() never caches through it. */
function fakeTxDbFrom(rows: FakeRow[]): { db: PrismaClient; callCount: () => number } {
  let calls = 0;
  const db = {
    plan: {
      findMany: async () => {
        calls++;
        return rows;
      },
    },
  } as unknown as PrismaClient;
  return { db, callCount: () => calls };
}

describe('plan registry (unit, synthetic data)', () => {
  beforeEach(() => {
    invalidatePlanRegistry();
  });

  it('throws rather than falling back to a hardcoded default when a plan row is missing', async () => {
    // Deliberately omits "volume" — simulates an unseeded / partially-seeded
    // plan table. A silent fallback here would reintroduce the two-authorities
    // problem this registry exists to eliminate.
    const { db } = fakeDbFrom([
      fakeRow({ key: 'starter', prices: [{ priceCents: 0, stripePriceId: null }] }),
      fakeRow({ key: 'pro', prices: [{ priceCents: 4900, stripePriceId: 'price_pro' }] }),
    ]);

    await expect(getPlanRegistry(db)).rejects.toThrow(/Missing "plan" row for tier "volume"/);
  });

  it('a paid plan with no active plan_price row resolves stripePriceId: null (never fabricates a price)', async () => {
    const { db } = fakeDbFrom([
      fakeRow({ key: 'starter', prices: [{ priceCents: 0, stripePriceId: null }] }),
      fakeRow({ key: 'pro', prices: [] }), // unconfigured — no active row
      fakeRow({ key: 'volume', prices: [{ priceCents: 14900, stripePriceId: 'price_volume' }] }),
    ]);

    const registry = await getPlanRegistry(db);
    expect(registry.pro.stripePriceId).toBeNull();
    expect(registry.pro.priceCents).toBe(0);
    // brand-billing.ts reads exactly this field to throw plan_price_unconfigured
    // at subscribe time — same behaviour as today when the env var is unset.
  });

  it('resolves priceCents/stripePriceId from the plan_price row even when they disagree with the historical display price — proves there is no fallback', async () => {
    // 5900 is deliberately NOT the historical Pro display price (4900). Today
    // Stripe and that historical value happen to agree in this environment,
    // so a regressed implementation reading
    // `activePrice ? HISTORICAL_PRO_DISPLAY_CENTS : 0` would pass every other
    // test in this file undetected — it would only produce a wrong number
    // where the two sources actually differ, which is exactly what this
    // fixture manufactures.
    expect(5900).not.toBe(HISTORICAL_PRO_DISPLAY_CENTS);
    const { db } = fakeDbFrom([
      fakeRow({ key: 'starter', prices: [{ priceCents: 0, stripePriceId: null }] }),
      fakeRow({ key: 'pro', prices: [{ priceCents: 5900, stripePriceId: 'price_x' }] }),
      fakeRow({ key: 'volume', prices: [{ priceCents: 14900, stripePriceId: 'price_y' }] }),
    ]);

    const registry = await getPlanRegistry(db);
    expect(registry.pro.priceCents).toBe(5900);
    expect(registry.pro.priceCents).not.toBe(HISTORICAL_PRO_DISPLAY_CENTS);
    expect(registry.pro.stripePriceId).toBe('price_x');
  });

  it('returns the same cached object on repeat calls within the TTL, issuing only one query', async () => {
    const { db, callCount } = fakeDbFrom([
      fakeRow({ key: 'starter' }),
      fakeRow({ key: 'pro' }),
      fakeRow({ key: 'volume' }),
    ]);

    const a = await getPlanRegistry(db);
    const b = await getPlanRegistry(db);
    const c = await getPlanRegistry(db);

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(callCount()).toBe(1);
  });

  it('invalidatePlanRegistry() forces a fresh object (and a fresh query) on the next call', async () => {
    const { db, callCount } = fakeDbFrom([
      fakeRow({ key: 'starter' }),
      fakeRow({ key: 'pro' }),
      fakeRow({ key: 'volume' }),
    ]);

    const a = await getPlanRegistry(db);
    invalidatePlanRegistry();
    const b = await getPlanRegistry(db);

    expect(b).not.toBe(a);
    expect(b).toEqual(a); // the underlying data is unchanged — only the cache was busted
    expect(callCount()).toBe(2);
  });

  it('concurrent calls during a cache miss share one in-flight fetch — only ONE database query (stampede guard)', async () => {
    const { db, callCount } = fakeDbFrom([
      fakeRow({ key: 'starter' }),
      fakeRow({ key: 'pro' }),
      fakeRow({ key: 'volume' }),
    ]);

    const [x, y, z] = await Promise.all([getPlanRegistry(db), getPlanRegistry(db), getPlanRegistry(db)]);

    expect(callCount()).toBe(1);
    expect(x).toBe(y);
    expect(y).toBe(z);
  });

  it('the cached registry is deeply frozen — a downstream mutation cannot poison it for the rest of the TTL', async () => {
    const { db } = fakeDbFrom([
      fakeRow({ key: 'starter' }),
      fakeRow({ key: 'pro', features: ['a feature'] }),
      fakeRow({ key: 'volume' }),
    ]);

    const registry = await getPlanRegistry(db);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.pro)).toBe(true);
    expect(Object.isFrozen(registry.pro.capabilities)).toBe(true);
    expect(Object.isFrozen(registry.pro.features)).toBe(true);
    // ESM modules run in strict mode — mutating a frozen object throws
    // rather than silently no-op'ing.
    expect(() => registry.pro.features.push('injected')).toThrow(TypeError);
  });

  it('a transaction-shaped client (no $transaction of its own) resolves fresh every time and never populates the shared cache', async () => {
    const rows = [
      fakeRow({ key: 'starter', prices: [{ priceCents: 0, stripePriceId: null }] }),
      fakeRow({ key: 'pro', prices: [{ priceCents: 4900, stripePriceId: 'price_pro' }] }),
      fakeRow({ key: 'volume', prices: [{ priceCents: 14900, stripePriceId: 'price_volume' }] }),
    ];
    const { db: txDb, callCount: txCalls } = fakeTxDbFrom(rows);

    const a = await getPlanRegistry(txDb);
    const b = await getPlanRegistry(txDb);
    expect(txCalls()).toBe(2); // no caching, no in-flight sharing — every call re-queries
    expect(b).not.toBe(a);
    expect(b).toEqual(a); // same data, just never the same cached object

    // And it never wrote to the process-wide cache: the next NORMAL client
    // call still has to query fresh (not "isn't the state a tx client saw").
    const { db: normalDb, callCount: normalCalls } = fakeDbFrom(rows);
    const c = await getPlanRegistry(normalDb);
    const d = await getPlanRegistry(normalDb);
    expect(normalCalls()).toBe(1); // second call served from cache, as normal
    expect(d).toBe(c);
  });
});

describe('buyablePlanCatalog (brand-billing.ts) — drops unbuyable paid plans off the wire', () => {
  function resolvedPlan(overrides: Partial<ResolvedPlan> & Pick<ResolvedPlan, 'key'>): ResolvedPlan {
    return {
      name: overrides.key,
      features: [],
      paid: overrides.key !== 'starter',
      priceCents: 0,
      stripePriceId: null,
      priceVersionId: null,
      capabilities: { storeConnections: false, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' },
      ...overrides,
    };
  }

  it('includes every tier when every paid tier has a configured active price', () => {
    const registry = {
      starter: resolvedPlan({ key: 'starter', paid: false, priceCents: 0, stripePriceId: null, priceVersionId: 'pv-starter' }),
      pro: resolvedPlan({ key: 'pro', paid: true, priceCents: 4900, stripePriceId: 'price_pro', priceVersionId: 'pv-pro' }),
      volume: resolvedPlan({ key: 'volume', paid: true, priceCents: 14900, stripePriceId: 'price_volume', priceVersionId: 'pv-volume' }),
    };

    expect(buyablePlanCatalog(registry).map((p) => p.key)).toEqual(['starter', 'pro', 'volume']);
    // price_version_id passes through unchanged — the token the wire hands back.
    expect(buyablePlanCatalog(registry).map((p) => p.price_version_id)).toEqual(['pv-starter', 'pv-pro', 'pv-volume']);
  });

  it('drops a paid tier with no active stripe price instead of showing it as a live $0 card', () => {
    const registry = {
      starter: resolvedPlan({ key: 'starter', paid: false, priceCents: 0, stripePriceId: null }),
      pro: resolvedPlan({ key: 'pro', paid: true, priceCents: 0, stripePriceId: null }), // unconfigured
      volume: resolvedPlan({ key: 'volume', paid: true, priceCents: 14900, stripePriceId: 'price_volume' }),
    };

    const catalog = buyablePlanCatalog(registry);
    expect(catalog.map((p) => p.key)).toEqual(['starter', 'volume']);
    expect(catalog.find((p) => p.key === 'pro')).toBeUndefined();
  });

  it('never drops starter, even though it is unpaid with no stripe price by design', () => {
    const registry = {
      starter: resolvedPlan({ key: 'starter', paid: false, priceCents: 0, stripePriceId: null }),
      pro: resolvedPlan({ key: 'pro', paid: true, priceCents: 4900, stripePriceId: 'price_pro' }),
      volume: resolvedPlan({ key: 'volume', paid: true, priceCents: 14900, stripePriceId: 'price_volume' }),
    };

    expect(buyablePlanCatalog(registry).some((p) => p.key === 'starter')).toBe(true);
  });
});

describe('storeConnectionsUpsellMessage (plan-registry.ts) — derived, not hardcoded, tier names', () => {
  function resolvedPlan(overrides: Partial<ResolvedPlan> & Pick<ResolvedPlan, 'key'>): ResolvedPlan {
    return {
      name: overrides.key,
      features: [],
      paid: overrides.key !== 'starter',
      priceCents: 0,
      stripePriceId: null,
      priceVersionId: null,
      capabilities: { storeConnections: false, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' },
      ...overrides,
    };
  }

  it('names both tiers when both Pro and Volume carry storeConnections', () => {
    const registry = {
      starter: resolvedPlan({ key: 'starter', capabilities: { storeConnections: false, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' } }),
      pro: resolvedPlan({ key: 'pro', name: 'Pro', capabilities: { storeConnections: true, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' } }),
      volume: resolvedPlan({ key: 'volume', name: 'Volume', capabilities: { storeConnections: true, maxOrdersPerMonth: null, shipping: 'live', shippingCutoff: '2 PM CST' } }),
    };
    expect(storeConnectionsUpsellMessage(registry)).toBe('Store connections require the Pro or Volume plan');
  });

  it('reflects an admin-renamed tier — proves the message is NOT a hardcoded "Pro or Volume" literal', () => {
    const registry = {
      starter: resolvedPlan({ key: 'starter', capabilities: { storeConnections: false, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' } }),
      pro: resolvedPlan({ key: 'pro', name: 'Growth', capabilities: { storeConnections: true, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' } }),
      volume: resolvedPlan({ key: 'volume', name: 'Scale', capabilities: { storeConnections: true, maxOrdersPerMonth: null, shipping: 'live', shippingCutoff: '2 PM CST' } }),
    };
    expect(storeConnectionsUpsellMessage(registry)).toBe('Store connections require the Growth or Scale plan');
  });

  it('names a single tier without "or" when only one carries the capability', () => {
    const registry = {
      starter: resolvedPlan({ key: 'starter', capabilities: { storeConnections: false, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' } }),
      pro: resolvedPlan({ key: 'pro', capabilities: { storeConnections: false, maxOrdersPerMonth: null, shipping: 'flat', shippingCutoff: '10 AM CST' } }),
      volume: resolvedPlan({ key: 'volume', name: 'Volume', capabilities: { storeConnections: true, maxOrdersPerMonth: null, shipping: 'live', shippingCutoff: '2 PM CST' } }),
    };
    expect(storeConnectionsUpsellMessage(registry)).toBe('Store connections require the Volume plan');
  });

  it('falls back to a plan-agnostic sentence when no tier carries the capability', () => {
    const registry = {
      starter: resolvedPlan({ key: 'starter' }),
      pro: resolvedPlan({ key: 'pro' }),
      volume: resolvedPlan({ key: 'volume' }),
    };
    expect(storeConnectionsUpsellMessage(registry)).toBe('Store connections are not available on your plan');
  });
});

// ── DB integration: the invariant that matters ────────────────────────────
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('plan registry (DB integration, read-only)', () => {
  beforeEach(() => {
    invalidatePlanRegistry();
  });

  afterAll(async () => {
    invalidatePlanRegistry();
    await prisma.$disconnect();
  });

  it(
    "resolves plans[].price_cents and stripe_price_id from the SAME active plan_price row per tier — " +
      'the exact invariant the original bug (displayed price vs. charged price drifting apart) violated',
    async () => {
      const registry = await getPlanRegistry(prisma);

      for (const key of PLAN_KEYS) {
        // Nullable read, not findFirstOrThrow: on an empty plan_price table
        // (CI — migration 030 deliberately leaves it empty, and ci.yml never
        // runs seed:plans) there is no active row for any tier, and the
        // registry's own documented behaviour (see the unit test above,
        // "never fabricates a price") is priceCents: 0 / stripePriceId:
        // null. This test stays read-only either way — it only compares two
        // reads of the same fact, never asserts an absolute amount.
        const activeRow = await prisma.planPrice.findFirst({ where: { plan: key, active: true } });
        // What GET /api/brand/subscription would display...
        expect(registry[key].priceCents).toBe(activeRow?.priceCents ?? 0);
        // ...is read from the same row POST /api/brand/billing/subscribe would charge.
        expect(registry[key].stripePriceId).toBe(activeRow?.stripePriceId ?? null);
      }
    },
  );
});
