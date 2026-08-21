import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@ruostack/db';
import { sweepArchivablePrices } from '../../src/services/reconciliation.ts';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';

/**
 * Fix 2 (final whole-branch review): the deferred-archive rail. `plan-price.ts`
 * no longer calls `payments.archivePrice()` in-request — this sweep is now the
 * only caller. These are fast, DB-free unit tests against a fake `planPrice`
 * row set (mirrors plan-registry.test.ts's `fakeDbFrom` pattern) so the
 * threshold/lookback/idempotent-continue behaviour is covered without needing
 * RUN_DB_TESTS=1.
 */

type FakeRow = { id: string; plan: string; stripePriceId: string | null };

/** Fixture row carrying the fields the real query filters on, so `dbWithRows`
 *  below can apply the same active/stripePriceId/archivedAt-window predicate
 *  Prisma's `where` would push down to Postgres. */
function row(overrides: Partial<FakeRow> & { archivedAt: Date | null; active?: boolean }): FakeRow & { archivedAt: Date | null; active: boolean } {
  return {
    id: overrides.id ?? 'pp_1',
    plan: overrides.plan ?? 'pro',
    stripePriceId: overrides.stripePriceId ?? 'price_old',
    active: overrides.active ?? false,
    archivedAt: overrides.archivedAt,
  };
}

/** Builds a fake `prisma.planPrice.findMany` that actually evaluates the
 *  active/stripePriceId/archivedAt-window predicate against fixture rows,
 *  the same predicate the real query passes to Postgres — so these tests
 *  exercise the boundary logic, not just "whatever findMany returns". */
function dbWithRows(rows: ReturnType<typeof row>[]): PrismaClient {
  return {
    planPrice: {
      findMany: async ({ where }: { where: { archivedAt: { lte: Date; gte: Date } } }) =>
        rows.filter(
          (r) =>
            r.active === false &&
            r.stripePriceId !== null &&
            r.archivedAt !== null &&
            r.archivedAt.getTime() <= where.archivedAt.lte.getTime() &&
            r.archivedAt.getTime() >= where.archivedAt.gte.getTime(),
        ),
    },
  } as unknown as PrismaClient;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('sweepArchivablePrices (reconciliation.ts) — the deferred-archive rail', () => {
  it('archives a row deactivated well past the 48h deferral', async () => {
    const db = dbWithRows([row({ id: 'pp_old', archivedAt: new Date(Date.now() - 72 * HOUR) })]);
    const fake = new FakePaymentsAdapter();

    const result = await sweepArchivablePrices(db, fake);

    expect(result).toEqual({ examined: 1, archived: 1, failed: 0 });
    expect(fake.callsFor('archivePrice')).toHaveLength(1);
    expect(fake.callsFor('archivePrice')[0]!.args[0]).toBe('price_old');
  });

  it('does NOT archive a row deactivated less than 48h ago — the whole point of the deferral', async () => {
    const db = dbWithRows([row({ id: 'pp_fresh', archivedAt: new Date(Date.now() - 2 * HOUR) })]);
    const fake = new FakePaymentsAdapter();

    const result = await sweepArchivablePrices(db, fake);

    expect(result).toEqual({ examined: 0, archived: 0, failed: 0 });
    expect(fake.callsFor('archivePrice')).toHaveLength(0);
  });

  it('does NOT archive a row deactivated beyond the lookback window (bounded, not eternal)', async () => {
    const db = dbWithRows([row({ id: 'pp_ancient', archivedAt: new Date(Date.now() - 45 * DAY) })]);
    const fake = new FakePaymentsAdapter();

    const result = await sweepArchivablePrices(db, fake);

    expect(result).toEqual({ examined: 0, archived: 0, failed: 0 });
    expect(fake.callsFor('archivePrice')).toHaveLength(0);
  });

  it('one Stripe failure does not stop the sweep from archiving the rest', async () => {
    const db = dbWithRows([
      row({ id: 'pp_a', plan: 'pro', stripePriceId: 'price_a', archivedAt: new Date(Date.now() - 72 * HOUR) }),
      row({ id: 'pp_b', plan: 'volume', stripePriceId: 'price_b', archivedAt: new Date(Date.now() - 72 * HOUR) }),
    ]);
    const fake = new FakePaymentsAdapter();
    fake.failOnCall('archivePrice', 1);

    const result = await sweepArchivablePrices(db, fake);

    expect(result).toEqual({ examined: 2, archived: 1, failed: 1 });
    expect(fake.callsFor('archivePrice')).toHaveLength(2);
    expect(fake.callsFor('archivePrice').map((c) => c.args[0])).toEqual(['price_a', 'price_b']);
  });

  it('is a no-op against an empty table', async () => {
    const db = dbWithRows([]);
    const fake = new FakePaymentsAdapter();

    expect(await sweepArchivablePrices(db, fake)).toEqual({ examined: 0, archived: 0, failed: 0 });
    expect(fake.callsFor('archivePrice')).toHaveLength(0);
  });
});
