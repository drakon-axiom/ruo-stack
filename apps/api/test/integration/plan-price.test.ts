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
// (starter/pro/volume, all active). This suite snapshots pro's AND volume's
// active rows in beforeAll and restores BOTH the same way in afterAll —
// deleting EVERY row for that plan that isn't the original (by construction,
// not by trusting a tracked id survived every assertion above it) BEFORE
// reactivating the original, since the partial unique index allows at most
// one active row per plan at a time. The restore is never wrapped in
// `.catch(() => undefined)`: a swallowed failure here is exactly how a
// previous suite's leak went unnoticed.
//
// `volume`'s active row is meant to stay untouched in practice — guard tests
// that need a real Stripe round-trip to prove a guard was actually passed
// (not just trivially satisfied) script a Stripe failure so the request
// dies before anything commits, and each cleans up its own resulting
// pending row in a `try/finally`. But "the scripted failure never fires" is
// exactly the case that slips past a `try/finally` and actually activates a
// new volume row — so afterAll repairs volume by construction too, the same
// as pro, rather than only asserting it's still correct and leaving a
// manual fix (like the one this task needed once already) as the only
// recovery if that assertion ever fails.
//
// This suite touches `subscription_state` only inside individual guard
// tests, each creating and deleting its own throwaway brand(s) + row(s)
// within a try/finally, and never creates an adminUser it doesn't delete.
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
    // Belt-and-braces, by CONSTRUCTION rather than by trusting that every
    // assertion above ran to completion in the right order: delete every
    // "pro" row that isn't the original real one, whatever it is and
    // however it got there (createdRowAId, createdRowBId, an untracked row
    // from an assertion that threw before assigning one, or a stray from
    // the partial-unique-index test if the index were ever gone). This is
    // strictly broader than — and supersedes — deleting just the two
    // tracked ids. Done BEFORE reactivating the original: the partial
    // unique index (plan_price_one_active_per_plan) allows at most one
    // active row per plan at any instant, and createdRowBId is active at
    // this point in the normal run.
    await prisma.planPrice.deleteMany({ where: { plan: 'pro', id: { not: originalProActive.id } } });
    await prisma.planPrice.update({
      where: { id: originalProActive.id },
      data: { active: true, archivedAt: null },
    });

    // Volume is meant to stay read-only in this suite, but two guard tests
    // now round-trip a real (scripted-to-fail) createPrice call against it —
    // each already cleans up its own pending row in try/finally, but "the
    // scripted failure never fires" is exactly the scenario that would slip
    // past a try/finally and actually commit. Rather than leaving that case
    // as assert-only (loud failure here, then the same manual repair this
    // task needed once already), give volume the same belt-and-braces sweep
    // as pro: repair by construction, not just detect.
    await prisma.planPrice.deleteMany({ where: { plan: 'volume', id: { not: originalVolumeActive.id } } });
    await prisma.planPrice.update({
      where: { id: originalVolumeActive.id },
      data: { active: true, archivedAt: null },
    });
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
      // Tracked immediately, before any assertion below can throw and skip
      // it — afterAll's belt-and-braces sweep also catches this row by
      // construction (anything on "pro" that isn't the original), but there
      // is no reason to depend on that alone when the id is right here.
      createdRowAId = body.plan_price_id;
      expect(body.price_cents).toBe(5900);
      expect(body.stripe_price_id).toMatch(/^price_fake_/);
      expect(body.previous_price_cents).toBe(4900);
      expect(body.previous_stripe_price_id).toBe(originalProActive.stripePriceId);

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

      // Find and track whatever row this attempt created for (pro, 6900) —
      // BEFORE asserting its shape, and with no filter on active/
      // stripePriceId, so it's tracked (and thus cleaned up) even in the
      // scenario this test exists to guard against: the scripted failure
      // not firing and the row activating instead of staying pending.
      const pending = await prisma.planPrice.findFirst({ where: { plan: 'pro', priceCents: 6900 } });
      if (pending) createdRowBId = pending.id;

      // The fake throws a plain Error (not an HttpError) — the route's
      // default error handler maps that to 500.
      expect(res.statusCode).toBe(500);

      // Exactly one createPrice call was attempted (and it failed) — no archive.
      expect(fake.calls.length).toBe(callsBefore + 1);
      expect(fake.calls[fake.calls.length - 1]!.method).toBe('createPrice');

      // A reusable PENDING row exists: active false, stripePriceId null.
      expect(pending).not.toBeNull();
      expect(pending!.active).toBe(false);
      expect(pending!.stripePriceId).toBeNull();

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

    it('an active subscriber -> 409 migration_required; a churned (cancelled) one alone does NOT block', async () => {
      const callsBefore = fake.calls.length;
      const activeBrand = await prisma.brand.create({
        data: { brandName: `Plan Price Guard Test Active ${randomToken(6)}`, referralCode: randomToken(10) },
      });
      const churnedBrand = await prisma.brand.create({
        data: { brandName: `Plan Price Guard Test Churned ${randomToken(6)}`, referralCode: randomToken(10) },
      });
      try {
        await prisma.subscriptionState.create({
          data: {
            brandId: activeBrand.id,
            plan: 'volume',
            status: 'active',
            stripeSubscriptionId: `sub_test_${randomToken(8)}`,
          },
        });
        // `plan` is never reset on churn (webhook.ts passes the resolved
        // tier through on `cancelled` too) — this row proves the guard
        // filters on status/stripeSubscriptionId, not just `plan`, or the
        // first brand ever to churn off a tier would block it from
        // repricing forever with a subscriber count that is factually false.
        await prisma.subscriptionState.create({
          data: {
            brandId: churnedBrand.id,
            plan: 'volume',
            status: 'cancelled',
            stripeSubscriptionId: `sub_test_${randomToken(8)}`,
          },
        });

        // Both rows present: the live (active) one blocks.
        await expect(
          changePlanPrice(prisma, fake, { plan: 'volume', priceCents: 9900, reason: 'x', actorId: financeAdminId }),
        ).rejects.toMatchObject({ statusCode: 409, code: 'migration_required' });
        expect(fake.calls.length).toBe(callsBefore);

        // Remove the live subscriber, leaving only the churned row — the
        // guard must not count it. Prove the guard was actually PASSED (not
        // just trivially satisfied by some other earlier guard) by scripting
        // a Stripe failure: the call must die at Stripe, not at the guard.
        await prisma.subscriptionState.deleteMany({ where: { brandId: activeBrand.id } });
        fake.failNextCall('createPrice');
        await expect(
          changePlanPrice(prisma, fake, { plan: 'volume', priceCents: 9900, reason: 'x', actorId: financeAdminId }),
        ).rejects.toThrow();
        expect(fake.calls.length).toBe(callsBefore + 1);
        expect(fake.calls[fake.calls.length - 1]!.method).toBe('createPrice');
      } finally {
        await prisma.subscriptionState.deleteMany({
          where: { brandId: { in: [activeBrand.id, churnedBrand.id] } },
        });
        await prisma.brand.deleteMany({ where: { id: { in: [activeBrand.id, churnedBrand.id] } } });
        // The failed attempt above left a reusable pending row on volume —
        // clean it up (never activated, so nothing else to restore).
        await prisma.planPrice.deleteMany({
          where: { plan: 'volume', priceCents: 9900, active: false, stripePriceId: null },
        });
      }

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

    it('confirm_large_change: true PASSES the guard for a >50% change (proven via a scripted Stripe failure, no commit)', async () => {
      // Both happy-path prices elsewhere in this suite are <25% moves, so
      // confirmLargeChange is never observed `true` anywhere else — a wrong
      // key at the route or a dropped Zod field would reject every
      // legitimate large change forever, silently, with nothing here to
      // catch it. Script a Stripe failure so the call dies at Stripe (not
      // at the guard, and not with a real commit to volume needing restore).
      //
      // try/finally, matching the churned-brand guard test above: `volume`
      // has NO restore path in afterAll (see its header comment) — if the
      // scripted failure ever failed to fire, an un-guarded cleanup here
      // would leave volume's live shared row permanently repriced to 5000c
      // with nothing to catch or repair it.
      const callsBefore = fake.calls.length;
      try {
        fake.failNextCall('createPrice');
        const res = await app.inject({
          method: 'POST',
          url: '/api/admin/plans/volume/price',
          headers: { authorization: `Bearer ${financeToken}` },
          payload: {
            price_cents: 5000,
            reason: 'Task 8 test: confirmed large change, scripted Stripe failure',
            confirm_large_change: true,
          },
        });

        expect(res.statusCode).toBe(500); // died at Stripe, not at the guard (which 409s)
        expect(fake.calls.length).toBe(callsBefore + 1);
        expect(fake.calls[fake.calls.length - 1]!.method).toBe('createPrice');
      } finally {
        // Clean up the resulting pending row for volume — never activated,
        // regardless of which assertion above did or didn't run.
        await prisma.planPrice.deleteMany({
          where: { plan: 'volume', priceCents: 5000, active: false, stripePriceId: null },
        });
      }
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
    // Known up front (not read back after the fact), so cleanup below can
    // target it by construction rather than by tracking an id that only
    // exists if creation unexpectedly succeeds.
    const dupStripeId = `price_test_dup_${randomToken(8)}`;
    try {
      await expect(
        prisma.planPrice.create({
          data: { plan: 'pro', priceCents: 1234, stripePriceId: dupStripeId, active: true },
        }),
      ).rejects.toThrow();
    } finally {
      // Belt-and-braces: if the index were ever dropped, this create would
      // actually succeed and leave TWO active "pro" rows — the exact
      // invariant getPlanRegistry()'s `take: 1` and brand-billing.ts assume
      // holds. The test guarding that safety net must not itself leak a
      // permanent violation of it when the safety net is gone.
      await prisma.planPrice.deleteMany({ where: { stripePriceId: dupStripeId } });
    }
  });

  it('getClients() is actually wired to the fake (sanity on the injection seam)', () => {
    expect(getClients().payments).toBe(fake);
  });
});
