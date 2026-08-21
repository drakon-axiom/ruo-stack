import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import type { CreatePriceInput } from '@ruostack/shared';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.ts';
import { getClients, resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';
import { changePlanPrice } from '../../src/services/plan-price.ts';

// The price-change transaction (Task 8): insert pending → Stripe → one
// atomic commit re-checking subscribers + flipping `active` + audit.
// Archiving the old Stripe price is deliberately NOT part of this request —
// see plan-price.ts's module doc comment and reconciliation-archive-sweep.test.ts.
// Self-skips unless RUN_DB_TESTS=1.
//
// HARD RULE: `plan_price` is a live, shared table — today it holds exactly 3
// rows (starter/pro/volume, all active), but this suite does NOT assume
// that: on an empty table (CI — migration 030 deliberately leaves it empty,
// and ci.yml never runs seed:plans) it seeds its own throwaway pro/volume
// fixture in beforeAll (see seededProFixture/seededVolumeFixture) and
// removes exactly that fixture in afterAll, leaving the table exactly as
// empty as it found it. Against the real (already-seeded) database this
// suite snapshots pro's AND volume's real active rows in beforeAll and
// restores BOTH the same way in afterAll — deleting EVERY row for that plan
// that isn't the original (by construction, not by trusting a tracked id
// survived every assertion above it) BEFORE reactivating the original,
// since the partial unique index allows at most one active row per plan at
// a time, both wrapped together in one `$transaction` so a process kill
// mid-cleanup can never leave a plan with zero active rows. The restore is
// never wrapped in `.catch(() => undefined)`: a swallowed failure here is
// exactly how a previous suite's leak went unnoticed. No assertion in this
// suite pins an absolute price (e.g. `toBe(4900)`) — every guard test reads
// the actually-active price and computes a target relative to it.
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

  // pro's/volume's real active row, snapshotted so it can be put back
  // exactly. Read nullable (findFirst, not findFirstOrThrow) — null on an
  // empty plan_price table, e.g. CI: migration 030 deliberately leaves it
  // empty and ci.yml never runs seed:plans. Mirrors seed-plans.test.ts's
  // "null on an empty database (nothing to restore)" pattern.
  let originalProActive: { id: string; priceCents: number; stripePriceId: string | null };
  let originalVolumeActive: { id: string; priceCents: number; stripePriceId: string | null };
  let originalProProductId: string | null;
  let originalVolumeProductId: string | null;
  // True only when THIS suite created the fixture because the table/column
  // was empty — distinguishes "restore the real thing" from "remove exactly
  // what we added" in afterAll.
  let seededProFixture = false;
  let seededVolumeFixture = false;
  let seededProProductId = false;
  let seededVolumeProductId = false;

  // The two plan_price rows this suite's happy-path/failure/retry sequence
  // creates on "pro" — tracked so afterAll can delete exactly these and
  // nothing else.
  let createdRowAId: string | undefined; // startingProCents -> 5900
  let createdRowBId: string | undefined; // 5900 -> 6900 (fails once, then retried)

  // Read off whatever is actually active at suite start rather than assumed
  // — this suite must not pin itself to the pre-reprice production fixture
  // (4900c/14900c) and break the day that number legitimately changes.
  let startingProCents: number;
  // A drop guaranteed to exceed the ±50% confirm_large_change threshold
  // regardless of what volume is actually priced at today.
  let largeDropVolumeCents: number;
  // A small, in-bounds move guaranteed to differ from volume's current
  // price, for guard tests that only care about "a different price", not
  // "how different".
  let migrationGuardTargetCents: number;

  beforeAll(async () => {
    const [proPlan, volumePlan] = await Promise.all([
      prisma.plan.findUniqueOrThrow({ where: { key: 'pro' } }),
      prisma.plan.findUniqueOrThrow({ where: { key: 'volume' } }),
    ]);
    originalProProductId = proPlan.stripeProductId;
    originalVolumeProductId = volumePlan.stripeProductId;

    const [proActive, volumeActive] = await Promise.all([
      prisma.planPrice.findFirst({ where: { plan: 'pro', active: true } }),
      prisma.planPrice.findFirst({ where: { plan: 'volume', active: true } }),
    ]);

    // This suite exercises repricing FROM a starting price, and
    // changePlanPrice needs plan.stripe_product_id to create a new Price
    // generation. On an empty plan_price table / unset stripe_product_id
    // (CI) there is neither — seed a throwaway fixture so the suite is
    // self-sufficient, tracked so afterAll removes exactly what it added
    // and nothing else. Against the real (already-seeded) database, none
    // of this fires — proActive/volumeActive/*ProductId are already set.
    if (!proPlan.stripeProductId) {
      await prisma.plan.update({ where: { key: 'pro' }, data: { stripeProductId: `prod_fixture_pro_${randomToken(6)}` } });
      seededProProductId = true;
    }
    if (!volumePlan.stripeProductId) {
      await prisma.plan.update({ where: { key: 'volume' }, data: { stripeProductId: `prod_fixture_volume_${randomToken(6)}` } });
      seededVolumeProductId = true;
    }
    if (proActive) {
      originalProActive = { id: proActive.id, priceCents: proActive.priceCents, stripePriceId: proActive.stripePriceId };
    } else {
      const seeded = await prisma.planPrice.create({
        data: { plan: 'pro', priceCents: 4900, stripePriceId: `price_fixture_pro_${randomToken(6)}`, active: true },
      });
      originalProActive = { id: seeded.id, priceCents: seeded.priceCents, stripePriceId: seeded.stripePriceId };
      seededProFixture = true;
    }
    if (volumeActive) {
      originalVolumeActive = { id: volumeActive.id, priceCents: volumeActive.priceCents, stripePriceId: volumeActive.stripePriceId };
    } else {
      const seeded = await prisma.planPrice.create({
        data: { plan: 'volume', priceCents: 14900, stripePriceId: `price_fixture_volume_${randomToken(6)}`, active: true },
      });
      originalVolumeActive = { id: seeded.id, priceCents: seeded.priceCents, stripePriceId: seeded.stripePriceId };
      seededVolumeFixture = true;
    }

    startingProCents = originalProActive.priceCents;
    // Self-check, not an assumption: the happy-path test below reprices pro
    // TO 5900 — if the starting price ever happened to already be 5900 that
    // test would 409 price_unchanged instead of exercising the happy path.
    expect(startingProCents).not.toBe(5900);

    largeDropVolumeCents = Math.max(100, Math.round(originalVolumeActive.priceCents * 0.2));
    // Self-check: this must actually clear the >50% threshold, or the
    // "requires confirm" guard test below would pass trivially without
    // exercising anything.
    expect(Math.abs(largeDropVolumeCents - originalVolumeActive.priceCents) / originalVolumeActive.priceCents).toBeGreaterThan(0.5);

    // A small, in-bounds move guaranteed to differ from volume's current
    // price — the migration_required guard test below needs to clear the
    // price_unchanged guard (which runs first) without depending on what
    // that current price actually is.
    migrationGuardTargetCents = Math.min(100_000, originalVolumeActive.priceCents + 500);
    expect(migrationGuardTargetCents).not.toBe(originalVolumeActive.priceCents);

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
    // assertion above ran to completion in the right order: remove every
    // "pro" row that isn't the original one, whatever it is and however it
    // got there (createdRowAId, createdRowBId, an untracked row from an
    // assertion that threw before assigning one, or a stray from the
    // partial-unique-index test if the index were ever gone).
    //
    // Wrapped in ONE transaction rather than a delete then a separate
    // update: between an unwrapped delete and reactivate, "pro" would have
    // ZERO active rows for a window — a process kill right there leaves
    // production at plan_price_unconfigured with Pro missing from the plan
    // picker. The transaction removes that window: either the whole
    // cleanup commits atomically, or none of it does and the (still
    // correct) pre-cleanup state stands.
    await prisma.$transaction(async (tx) => {
      if (seededProFixture) {
        // This suite created pro's active row from nothing (empty
        // plan_price table) — leave it exactly as empty as it found it.
        await tx.planPrice.deleteMany({ where: { plan: 'pro' } });
      } else {
        await tx.planPrice.deleteMany({ where: { plan: 'pro', id: { not: originalProActive.id } } });
        await tx.planPrice.update({ where: { id: originalProActive.id }, data: { active: true, archivedAt: null } });
      }

      // Volume is meant to stay read-only in this suite, but two guard
      // tests round-trip a real (scripted-to-fail) createPrice call against
      // it — each already cleans up its own pending row in try/finally, but
      // "the scripted failure never fires" is exactly the scenario that
      // would slip past a try/finally and actually commit. Rather than
      // leaving that case as assert-only, give volume the same
      // belt-and-braces sweep as pro: repair by construction, not just
      // detect. Same empty-table branch as pro, for the same reason.
      if (seededVolumeFixture) {
        await tx.planPrice.deleteMany({ where: { plan: 'volume' } });
      } else {
        await tx.planPrice.deleteMany({ where: { plan: 'volume', id: { not: originalVolumeActive.id } } });
        await tx.planPrice.update({ where: { id: originalVolumeActive.id }, data: { active: true, archivedAt: null } });
      }
    });

    if (seededVolumeFixture) {
      expect(await prisma.planPrice.findFirst({ where: { plan: 'volume' } })).toBeNull();
    } else {
      const volumeNow = await prisma.planPrice.findUniqueOrThrow({ where: { id: originalVolumeActive.id } });
      expect(volumeNow.active).toBe(true);
      expect(volumeNow.archivedAt).toBeNull();
    }

    if (seededProProductId) {
      await prisma.plan.update({ where: { key: 'pro' }, data: { stripeProductId: originalProProductId } });
    }
    if (seededVolumeProductId) {
      await prisma.plan.update({ where: { key: 'volume' }, data: { stripeProductId: originalVolumeProductId } });
    }

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
      expect(body.previous_price_cents).toBe(startingProCents);
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

      // Exactly one createPrice call happened. Archiving the old Stripe
      // price is deliberately NOT done in-request (Fix 2 / plan Rail 3) —
      // it's picked up later by the reconciliation worker's
      // sweepArchivablePrices, ~48h after archivedAt, so an in-flight
      // Checkout Session holding the old price has time to drain. See
      // reconciliation-archive-sweep.test.ts for that behaviour.
      expect(fake.calls.length).toBe(callsBefore + 1); // createPrice only
      expect(fake.calls[fake.calls.length - 1]!.method).toBe('createPrice');
      expect(fake.callsFor('archivePrice')).toHaveLength(0);
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

      // createPrice only this time too — archiving stays deferred to the
      // reconciliation sweep, not performed in-request (Fix 2).
      expect(fake.calls.length).toBe(callsBefore + 1);
      expect(fake.callsFor('archivePrice')).toHaveLength(0);

      const createCalls = fake.callsFor('createPrice');
      // The failed attempt and this retry both targeted the same pending row id.
      const forRowB = createCalls.filter((c) => c.idempotencyKey === `price:${createdRowBId}`);
      expect(forRowB.length).toBe(2);
      expect(forRowB[0]!.idempotencyKey).toBe(forRowB[1]!.idempotencyKey);

      // Exactly one active row for pro, and it's row B now.
      const activeRows = await prisma.planPrice.findMany({ where: { plan: 'pro', active: true } });
      expect(activeRows).toHaveLength(1);
      expect(activeRows[0]!.id).toBe(createdRowBId);

      // Row A (5900) is deactivated (archivedAt stamped in our ledger) —
      // the previous active row — even though it has not yet been archived
      // in Stripe itself; that's the sweep's job, deferred ~48h.
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
          changePlanPrice(prisma, fake, { plan: 'volume', priceCents: migrationGuardTargetCents, reason: 'x', actorId: financeAdminId }),
        ).rejects.toMatchObject({ statusCode: 409, code: 'migration_required' });
        expect(fake.calls.length).toBe(callsBefore);

        // Remove the live subscriber, leaving only the churned row — the
        // guard must not count it. Prove the guard was actually PASSED (not
        // just trivially satisfied by some other earlier guard) by scripting
        // a Stripe failure: the call must die at Stripe, not at the guard.
        await prisma.subscriptionState.deleteMany({ where: { brandId: activeBrand.id } });
        fake.failNextCall('createPrice');
        await expect(
          changePlanPrice(prisma, fake, { plan: 'volume', priceCents: migrationGuardTargetCents, reason: 'x', actorId: financeAdminId }),
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
          where: { plan: 'volume', priceCents: migrationGuardTargetCents, active: false, stripePriceId: null },
        });
      }

      // The hard rule: subscription_state must be empty again.
      expect(await prisma.subscriptionState.count()).toBe(0);
    });

    it('a change over ±50% without confirm_large_change -> 409, requires confirm', async () => {
      const callsBefore = fake.calls.length;
      // largeDropVolumeCents is computed in beforeAll to be >50% below
      // whatever volume's active price actually is (self-checked there).
      await expect(
        changePlanPrice(prisma, fake, { plan: 'volume', priceCents: largeDropVolumeCents, reason: 'x', actorId: financeAdminId }),
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
      // try/finally, matching the churned-brand guard test above: belt-
      // and-braces. This cleans up the pending row immediately if the
      // scripted failure fires as expected; afterAll's volume sweep (see
      // its header comment) is the second line of defence if it doesn't.
      const callsBefore = fake.calls.length;
      try {
        fake.failNextCall('createPrice');
        const res = await app.inject({
          method: 'POST',
          url: '/api/admin/plans/volume/price',
          headers: { authorization: `Bearer ${financeToken}` },
          payload: {
            price_cents: largeDropVolumeCents,
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
          where: { plan: 'volume', priceCents: largeDropVolumeCents, active: false, stripePriceId: null },
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

  describe('the in-transaction subscriber re-check (Fix 3: closes the check-then-act window)', () => {
    /** Wraps FakePaymentsAdapter to inject a side effect into createPrice —
     *  the Stripe round-trip Step C waits on — standing in for a
     *  `subscription.activated` webhook that lands during that wait. */
    class RaceInjectingPaymentsAdapter extends FakePaymentsAdapter {
      private readonly onCreatePrice: () => Promise<void>;
      constructor(onCreatePrice: () => Promise<void>) {
        super();
        this.onCreatePrice = onCreatePrice;
      }
      override async createPrice(input: CreatePriceInput): Promise<{ priceId: string }> {
        await this.onCreatePrice();
        return super.createPrice(input);
      }
    }

    it('a subscriber landing during the Stripe round-trip aborts Step C with migration_required, not a silent commit', async () => {
      // The outer pre-flight guard (subscriberCount === 0) passes here —
      // subscription_state is empty at this point in the suite (every
      // earlier guard test restores it to 0; asserted below too). The race
      // is injected entirely inside createPrice, exactly where the real gap
      // sits: after the pre-flight read, before Step C's transaction.
      const racingBrand = await prisma.brand.create({
        data: { brandName: `Plan Price Race Test ${randomToken(6)}`, referralCode: randomToken(10) },
      });
      let racingSubscriptionId: string | undefined;
      const racingFake = new RaceInjectingPaymentsAdapter(async () => {
        const sub = await prisma.subscriptionState.create({
          data: {
            brandId: racingBrand.id,
            plan: 'volume',
            status: 'active',
            stripeSubscriptionId: `sub_race_${randomToken(8)}`,
          },
        });
        racingSubscriptionId = sub.id;
      });

      try {
        await expect(
          changePlanPrice(prisma, racingFake, {
            plan: 'volume',
            priceCents: migrationGuardTargetCents,
            reason: 'Fix 3 test: subscriber lands mid-Stripe-round-trip',
            actorId: financeAdminId,
          }),
        ).rejects.toMatchObject({ statusCode: 409, code: 'migration_required' });

        // createPrice DID run (that's how the race was injected) — but
        // nothing committed: Step C's transaction rolled back entirely,
        // including the stripePriceId stamp it wrote before the re-check
        // fired. Without Fix 3 this assertion is what would fail — Step C
        // would deactivate the real active row and activate the pending
        // one, stranding racingBrand on a price about to disappear.
        expect(racingFake.callsFor('createPrice')).toHaveLength(1);
        const activeAfter = await prisma.planPrice.findFirstOrThrow({ where: { plan: 'volume', active: true } });
        expect(activeAfter.id).toBe(originalVolumeActive.id);

        // The pending row Step A inserted is still there (reusable on
        // retry), with stripePriceId rolled back to null.
        const pending = await prisma.planPrice.findFirst({
          where: { plan: 'volume', priceCents: migrationGuardTargetCents, active: false },
        });
        expect(pending).not.toBeNull();
        expect(pending!.stripePriceId).toBeNull();
      } finally {
        if (racingSubscriptionId) {
          await prisma.subscriptionState.delete({ where: { id: racingSubscriptionId } });
        }
        await prisma.brand.delete({ where: { id: racingBrand.id } });
        await prisma.planPrice.deleteMany({
          where: { plan: 'volume', priceCents: migrationGuardTargetCents, active: false, stripePriceId: null },
        });
      }

      // The hard rule: subscription_state must be empty again.
      expect(await prisma.subscriptionState.count()).toBe(0);
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
