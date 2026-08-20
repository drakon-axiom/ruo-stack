import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@ruostack/db';
import { getPrisma } from '@ruostack/db';
import { PLAN_KEYS } from '@ruostack/shared';
import { getPlanRegistry, invalidatePlanRegistry } from '../../src/services/plan-registry.ts';

/**
 * plan-registry.ts is the switchover: every backend consumer that used to
 * read the `PLANS` constant now awaits `getPlanRegistry(db)`. Two groups of
 * tests here:
 *
 * 1. Unit tests against a synthetic, in-memory `plan.findMany` — no real DB
 *    write, so no snapshot/restore is needed. These prove the registry's own
 *    contract: throws on a missing tier, never fabricates a price for an
 *    unconfigured paid plan, and the memoization/stampede-guard/invalidation
 *    behaviour.
 * 2. One DB-integration test (RUN_DB_TESTS=1) proving the exact invariant
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
 *  real query would apply it) and counts how many times it was called. */
function fakeDbFrom(rows: FakeRow[]): { db: PrismaClient; callCount: () => number } {
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
        const activeRow = await prisma.planPrice.findFirstOrThrow({ where: { plan: key, active: true } });
        // What GET /api/brand/subscription would display...
        expect(registry[key].priceCents).toBe(activeRow.priceCents);
        // ...is read from the same row POST /api/brand/billing/subscribe would charge.
        expect(registry[key].stripePriceId).toBe(activeRow.stripePriceId);
      }
    },
  );
});
