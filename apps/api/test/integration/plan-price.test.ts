import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.ts';
import { getClients, resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';
import { changePlanPrice } from '../../src/services/plan-price.ts';

// The price-change transaction (Task 8): insert pending → Stripe → one
// atomic commit flipping `active` + audit → deferred archive. Self-skips
// unless RUN_DB_TESTS=1.
//
// HARD RULE: `plan_price` is a live, shared table with exactly 3 rows today
// (starter/pro/volume, all active). This suite snapshots pro's active row in
// beforeAll and restores it in afterAll, deleting the two rows this suite
// creates (deactivate/delete BEFORE reactivating the original — the partial
// unique index allows at most one active row per plan at a time). The
// restore is never wrapped in `.catch(() => undefined)`: a swallowed
// failure here is exactly how a previous suite's leak went unnoticed. This
// suite never touches `subscription_state` outside a single guard test,
// which creates and deletes its own throwaway brand + row within a
// try/finally, and never creates an adminUser it doesn't delete.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Plan Price Admin',
      role,
      passwordHash: await hashPassword('x'),
      status: 'active',
      mfaEnabled: true,
    },
  });
  const session = await prisma.adminSession.create({
    data: { adminUserId: admin.id, refreshTokenHash: hashToken(randomToken(32)), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { admin, token: signAdminAccessToken({ sub: admin.id, role, sid: session.id }) };
}

describe.skipIf(!RUN)('plan price change transaction (DB integration)', () => {
  let app: FastifyInstance;
  let fake: FakePaymentsAdapter;
  let financeToken: string;
  let financeAdminId: string;
  let supportToken: string;
  const adminIds: string[] = [];

  // pro's real active row, snapshotted so it can be put back exactly.
  let originalProActive: { id: string; priceCents: number; stripePriceId: string | null };
  let originalVolumeActive: { id: string; priceCents: number; stripePriceId: string | null };

  // The two plan_price rows this suite's happy-path/failure/retry sequence
  // creates on "pro" — tracked so afterAll can delete exactly these and
  // nothing else.
  let createdRowAId: string | undefined; // 4900 -> 5900
  let createdRowBId: string | undefined; // 5900 -> 6900 (fails once, then retried)

  beforeAll(async () => {
    const [pro, volume] = await Promise.all([
      prisma.planPrice.findFirstOrThrow({ where: { plan: 'pro', active: true } }),
      prisma.planPrice.findFirstOrThrow({ where: { plan: 'volume', active: true } }),
    ]);
    originalProActive = { id: pro.id, priceCents: pro.priceCents, stripePriceId: pro.stripePriceId };
    originalVolumeActive = { id: volume.id, priceCents: volume.priceCents, stripePriceId: volume.stripePriceId };
    // The volume row is read-only in this suite (guard tests only) — confirm
    // the pre-flight numbers this whole plan was built against, so a drifted
    // fixture fails loudly here instead of producing a confusing guard-test
    // failure later.
    expect(originalProActive.priceCents).toBe(4900);
    expect(originalVolumeActive.priceCents).toBe(14900);

    fake = new FakePaymentsAdapter();
    setClientsForTest({ payments: fake });

    app = await buildApp();
    await app.ready();

    const finance = await seedAdmin('finance');
    const support = await seedAdmin('support');
    financeToken = finance.token;
    financeAdminId = finance.admin.id;
    supportToken = support.token;
    adminIds.push(finance.admin.id, support.admin.id);
  });

  afterAll(async () => {
    // Delete the test-created rows BEFORE reactivating the original — the
    // partial unique index (plan_price_one_active_per_plan) allows at most
    // one active row per plan at any instant, and createdRowBId is active
    // at this point.
    const toDelete = [createdRowAId, createdRowBId].filter((id): id is string => !!id);
    if (toDelete.length > 0) {
      await prisma.planPrice.deleteMany({ where: { id: { in: toDelete } } });
    }
    await prisma.planPrice.update({
      where: { id: originalProActive.id },
      data: { active: true, archivedAt: null },
    });

    // Volume was never mutated by this suite, but assert that plainly rather
    // than assume it — a stray write here would be exactly the kind of leak
    // this hard rule exists to catch.
    const volumeNow = await prisma.planPrice.findUniqueOrThrow({ where: { id: originalVolumeActive.id } });
    expect(volumeNow.active).toBe(true);
    expect(volumeNow.archivedAt).toBeNull();

    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    resetClientsForTest();
    await app.close();
    await prisma.$disconnect();
  });

  describe('the lifecycle: happy path -> Stripe failure -> retry (all on "pro")', () => {
    it('happy path: active flips atomically and the new row carries the Stripe id the fake returned', async () => {
      const callsBefore = fake.calls.length;

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/plans/pro/price',
        headers: { authorization: `Bearer ${financeToken}` },
        payload: { price_cents: 5900, reason: 'Task 8 test: happy path repricing' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.price_cents).toBe(5900);
      expect(body.stripe_price_id).toMatch(/^price_fake_/);
      expect(body.previous_price_cents).toBe(4900);
      expect(body.previous_stripe_price_id).toBe(originalProActive.stripePriceId);
      createdRowAId = body.plan_price_id;

      // Exactly one active row for pro.
      const activeRows = await prisma.planPrice.findMany({ where: { plan: 'pro', active: true } });
      expect(activeRows).toHaveLength(1);
      expect(activeRows[0]!.id).toBe(createdRowAId);
      expect(activeRows[0]!.priceCents).toBe(5900);
      expect(activeRows[0]!.stripePriceId).toBe(body.stripe_price_id);

      // The old row is deactivated, not deleted.
      const oldRow = await prisma.planPrice.findUniqueOrThrow({ where: { id: originalProActive.id } });
      expect(oldRow.active).toBe(false);
      expect(oldRow.archivedAt).not.toBeNull();

      // Exactly one createPrice call happened, and the old Stripe price was
      // archived (deferred, best-effort, post-commit).
      expect(fake.calls.length).toBe(callsBefore + 2); // createPrice + archivePrice
      const archiveCalls = fake.callsFor('archivePrice');
      expect(archiveCalls[archiveCalls.length - 1]!.args[0]).toBe(originalProActive.stripePriceId);
    });

    it('a Stripe failure leaves a reusable pending row and changes nothing active', async () => {
      fake.failNextCall('createPrice');
      const callsBefore = fake.calls.length;
      const activeBefore = await prisma.planPrice.findFirstOrThrow({ where: { plan: 'pro', active: true } });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/plans/pro/price',
        headers: { authorization: `Bearer ${financeToken}` },
        payload: { price_cents: 6900, reason: 'Task 8 test: triggers a scripted Stripe failure' },
      });

      // The fake throws a plain Error (not an HttpError) — the route's
      // default error handler maps that to 500.
      expect(res.statusCode).toBe(500);

      // Exactly one createPrice call was attempted (and it failed) — no archive.
      expect(fake.calls.length).toBe(callsBefore + 1);
      expect(fake.calls[fake.calls.length - 1]!.method).toBe('createPrice');

      // A reusable PENDING row exists: active false, stripePriceId null.
      const pending = await prisma.planPrice.findFirst({
        where: { plan: 'pro', priceCents: 6900, active: false, stripePriceId: null },
      });
      expect(pending).not.toBeNull();
      createdRowBId = pending!.id;

      // Nothing active changed — no partial commit.
      const activeAfter = await prisma.planPrice.findFirstOrThrow({ where: { plan: 'pro', active: true } });
      expect(activeAfter.id).toBe(activeBefore.id);
      expect(activeAfter.priceCents).toBe(5900);
    });

    it('retrying reuses the SAME pending row and the SAME idempotency key', async () => {
      expect(createdRowBId).toBeDefined();
      const callsBefore = fake.calls.length;

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/plans/pro/price',
        headers: { authorization: `Bearer ${financeToken}` },
        payload: { price_cents: 6900, reason: 'Task 8 test: retry after the scripted failure' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Same row reused, not a new one minted.
      expect(body.plan_price_id).toBe(createdRowBId);
      expect(body.price_cents).toBe(6900);

      // createPrice + archivePrice this time.
      expect(fake.calls.length).toBe(callsBefore + 2);

      const createCalls = fake.callsFor('createPrice');
      // The failed attempt and this retry both targeted the same pending row id.
      const forRowB = createCalls.filter((c) => c.idempotencyKey === `price:${createdRowBId}`);
      expect(forRowB.length).toBe(2);
      expect(forRowB[0]!.idempotencyKey).toBe(forRowB[1]!.idempotencyKey);

      // Exactly one active row for pro, and it's row B now.
      const activeRows = await prisma.planPrice.findMany({ where: { plan: 'pro', active: true } });
      expect(activeRows).toHaveLength(1);
      expect(activeRows[0]!.id).toBe(createdRowBId);

      // Row A (5900) is now archived — the previous active row.
      const rowA = await prisma.planPrice.findUniqueOrThrow({ where: { id: createdRowAId! } });
      expect(rowA.active).toBe(false);
      expect(rowA.archivedAt).not.toBeNull();
    });
  });

  describe('role gate', () => {
    it('support (view-only on the plans surface) is refused — 403, no Stripe call, nothing written', async () => {
      const callsBefore = fake.calls.length;
      const countBefore = await prisma.planPrice.count({ where: { plan: 'pro' } });

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/plans/pro/price',
        headers: { authorization: `Bearer ${supportToken}` },
        payload: { price_cents: 7900, reason: 'support should never get here' },
      });

      expect(res.statusCode).toBe(403);
      expect(fake.calls.length).toBe(callsBefore);
      expect(await prisma.planPrice.count({ where: { plan: 'pro' } })).toBe(countBefore);
    });
  });

  describe('guards — every one rejects before any Stripe call', () => {
    it('starter -> 400 starter_is_free', async () => {
      const callsBefore = fake.calls.length;
      await expect(
        changePlanPrice(prisma, fake, { plan: 'starter', priceCents: 500, reason: 'x', actorId: financeAdminId }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'starter_is_free' });
      expect(fake.calls.length).toBe(callsBefore);
    });

    it('unchanged price -> 409 price_unchanged', async () => {
      const callsBefore = fake.calls.length;
      await expect(
        changePlanPrice(prisma, fake, {
          plan: 'volume',
          priceCents: originalVolumeActive.priceCents,
          reason: 'x',
          actorId: financeAdminId,
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'price_unchanged' });
      expect(fake.calls.length).toBe(callsBefore);
    });

    it('subscribers exist -> 409 migration_required (Phase 2 worker is deliberately not built)', async () => {
      const callsBefore = fake.calls.length;
      const brand = await prisma.brand.create({
        data: { brandName: `Plan Price Guard Test ${randomToken(6)}`, referralCode: randomToken(10) },
      });
      try {
        await prisma.subscriptionState.create({
          data: { brandId: brand.id, plan: 'volume', status: 'active' },
        });
        await expect(
          changePlanPrice(prisma, fake, { plan: 'volume', priceCents: 9900, reason: 'x', actorId: financeAdminId }),
        ).rejects.toMatchObject({ statusCode: 409, code: 'migration_required' });
      } finally {
        await prisma.subscriptionState.deleteMany({ where: { brandId: brand.id } });
        await prisma.brand.delete({ where: { id: brand.id } });
      }
      expect(fake.calls.length).toBe(callsBefore);

      // The hard rule: subscription_state must be empty again.
      expect(await prisma.subscriptionState.count()).toBe(0);
    });

    it('a change over ±50% without confirm_large_change -> 409, requires confirm', async () => {
      const callsBefore = fake.calls.length;
      // volume is at 14900c; 5000c is a 66% drop.
      await expect(
        changePlanPrice(prisma, fake, { plan: 'volume', priceCents: 5000, reason: 'x', actorId: financeAdminId }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'confirm_large_change_required' });
      expect(fake.calls.length).toBe(callsBefore);
    });

    it('price_cents out of bounds -> 400, rejected by validation before the handler runs', async () => {
      const callsBefore = fake.calls.length;

      const tooLow = await app.inject({
        method: 'POST',
        url: '/api/admin/plans/volume/price',
        headers: { authorization: `Bearer ${financeToken}` },
        payload: { price_cents: 50, reason: 'below the 100c floor' },
      });
      expect(tooLow.statusCode).toBe(400);

      const tooHigh = await app.inject({
        method: 'POST',
        url: '/api/admin/plans/volume/price',
        headers: { authorization: `Bearer ${financeToken}` },
        payload: { price_cents: 200_000, reason: 'above the 100,000c ceiling' },
      });
      expect(tooHigh.statusCode).toBe(400);

      expect(fake.calls.length).toBe(callsBefore);
    });

    it('missing/empty reason -> 400, rejected by validation before the handler runs', async () => {
      const callsBefore = fake.calls.length;
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/plans/volume/price',
        headers: { authorization: `Bearer ${financeToken}` },
        payload: { price_cents: 15900, reason: '' },
      });
      expect(res.statusCode).toBe(400);
      expect(fake.calls.length).toBe(callsBefore);
    });
  });

  it('the partial unique index rejects a hand-crafted second active row', async () => {
    await expect(
      prisma.planPrice.create({
        data: {
          plan: 'pro',
          priceCents: 1234,
          stripePriceId: `price_test_dup_${randomToken(8)}`,
          active: true,
        },
      }),
    ).rejects.toThrow();
  });

  it('getClients() is actually wired to the fake (sanity on the injection seam)', () => {
    expect(getClients().payments).toBe(fake);
  });
});
