import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.ts';
import { invalidatePlanRegistry, getPlanRegistry } from '../../src/services/plan-registry.ts';

// Admin read/edit surface for the plan registry: role gate (support 403 /
// finance through), the registry-invalidation contract (a write must not
// leave the next read serving a stale cached value for up to 60s), and the
// audit trail. Self-skips unless RUN_DB_TESTS=1.
//
// HARD RULE: `plan` is a live, shared table (starter/pro/volume, exactly one
// row each) — this suite snapshots the ONE row it edits (starter — no price
// to protect, chosen deliberately over pro/volume) in beforeAll and restores
// it in afterAll. This suite never WRITES `plan_price` on its own initiative,
// but the price-history test READS it through /api/admin/plans/pro/history,
// which depends on an active "pro" row existing — false on an empty database
// (CI). That test conditionally seeds one (tracked in planPriceIds, same
// seeded-vs-real cleanup polarity as plan-price.test.ts /
// brand-subscribe-quote.test.ts) rather than assuming it.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Plans Admin',
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

describe.skipIf(!RUN)('admin plan registry surface (DB integration)', () => {
  let app: FastifyInstance;
  let financeToken: string;
  let financeAdminId: string;
  let supportToken: string;
  const adminIds: string[] = [];
  // Tracks a throwaway "pro" plan_price row this suite seeds ONLY when none
  // is active (empty database) — never a real row this suite deactivates or
  // mutates, so cleanup is a plain delete, not a restore.
  let seededProPriceId: string | undefined;

  let originalStarter: { name: string; features: string[]; shippingCutoff: string };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const finance = await seedAdmin('finance');
    const support = await seedAdmin('support');
    financeToken = finance.token;
    financeAdminId = finance.admin.id;
    supportToken = support.token;
    adminIds.push(finance.admin.id, support.admin.id);

    const starter = await prisma.plan.findUniqueOrThrow({ where: { key: 'starter' } });
    originalStarter = { name: starter.name, features: starter.features, shippingCutoff: starter.shippingCutoff };

    // The price-history test reads "pro"'s active plan_price row through the
    // route — guaranteed present on the live (already-seeded) database, but
    // NOT on an empty one (CI: migration 030 leaves plan_price empty and
    // ci.yml never runs seed:plans). Seed a throwaway active row only when
    // none exists, tracked for a plain delete in afterAll (never a restore —
    // this suite never deactivates or mutates an existing "pro" row).
    const activePro = await prisma.planPrice.findFirst({ where: { plan: 'pro', active: true } });
    if (!activePro) {
      const seeded = await prisma.planPrice.create({
        data: { plan: 'pro', priceCents: 4900, stripePriceId: `price_fixture_history_${randomToken(6)}`, active: true },
      });
      seededProPriceId = seeded.id;
    }
  });

  afterAll(async () => {
    // Restore starter exactly as found, regardless of which test last wrote it.
    // Never swallowed: a failed restore here is exactly the live-data hazard
    // this branch already got bitten by once (see plan-price.test.ts's rule).
    await prisma.plan.update({
      where: { key: 'starter' },
      data: {
        name: originalStarter.name,
        features: originalStarter.features,
        shippingCutoff: originalStarter.shippingCutoff,
        updatedBy: null,
      },
    });
    invalidatePlanRegistry();
    if (seededProPriceId) {
      await prisma.planPrice.delete({ where: { id: seededProPriceId } });
    }
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  it('support (view-only) is refused a PATCH — 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/plans/starter',
      headers: { authorization: `Bearer ${supportToken}` },
      payload: { name: 'Should not stick' },
    });
    expect(res.statusCode).toBe(403);

    // And left absolutely no mark on the row.
    const starter = await prisma.plan.findUniqueOrThrow({ where: { key: 'starter' } });
    expect(starter.name).toBe(originalStarter.name);
  });

  it('support CAN read the surface (view access)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/plans',
      headers: { authorization: `Bearer ${supportToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plans.map((p: { key: string }) => p.key).sort()).toEqual(['pro', 'starter', 'volume']);
  });

  it('support (view-only) can read a plan\'s price history — read-only, gated on the same "plans" surface', async () => {
    // Read the SAME row the route resolves, rather than assuming its shape:
    // on the live database this is the real active "pro" row; on an empty
    // one it's the throwaway fixture beforeAll seeded. Either way the route
    // must reflect it — asserting a hardcoded 4900/price_1ThLOY… would pin
    // this suite to the pre-reprice production fixture and break the first
    // time "pro" is legitimately repriced, the exact class of bug the final
    // review flagged elsewhere in this branch.
    const activeRow = await prisma.planPrice.findFirstOrThrow({ where: { plan: 'pro', active: true } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/plans/pro/history',
      headers: { authorization: `Bearer ${supportToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBe('pro');
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBeGreaterThan(0);
    const active = body.history.find((h: { active: boolean }) => h.active);
    expect(active).toBeTruthy();
    expect(active.price_cents).toBe(activeRow.priceCents);
    expect(active.stripe_price_id).toBe(activeRow.stripePriceId);
    expect(active.archived_at).toBeNull();
    // Reason comes from the plan.price_changed audit row, not plan_price itself.
    expect(typeof active.created_at).toBe('string');
  });

  it("starter's price history is empty — it has never had a Stripe price", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/plans/starter/history',
      headers: { authorization: `Bearer ${financeToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toBe('starter');
    expect(body.history).toEqual([]);
  });

  it('an unknown plan key 400s (never a bare 404 that could be mistaken for "no history")', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/plans/not-a-real-plan/history',
      headers: { authorization: `Bearer ${financeToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('finance (write) can PATCH name/features/shipping_cutoff on starter — fully editable, no price on this route', async () => {
    const newName = `Starter Test ${randomToken(4)}`;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/plans/starter',
      headers: { authorization: `Bearer ${financeToken}` },
      payload: { name: newName, features: ['free forever', 'community support'], shipping_cutoff: '9 AM CST' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe(newName);
    expect(body.features).toEqual(['free forever', 'community support']);
    expect(body.shipping_cutoff).toBe('9 AM CST');

    const row = await prisma.plan.findUniqueOrThrow({ where: { key: 'starter' } });
    expect(row.name).toBe(newName);
    expect(row.updatedBy).toBe(financeAdminId);
  });

  it('the PATCH invalidates the registry — a subsequent read sees the new value, not a stale cached one', async () => {
    // Prime the cache with the CURRENT (pre-edit) value.
    invalidatePlanRegistry();
    const before = await getPlanRegistry(prisma);
    expect(before.starter.name).not.toBe('Freshly Repriced Starter');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/plans/starter',
      headers: { authorization: `Bearer ${financeToken}` },
      payload: { name: 'Freshly Repriced Starter' },
    });
    expect(res.statusCode).toBe(200);

    // No manual invalidatePlanRegistry() call here — proving the ROUTE itself
    // invalidates, not the test forcing a fresh read.
    const after = await getPlanRegistry(prisma);
    expect(after.starter.name).toBe('Freshly Repriced Starter');
  });

  it('writes an audit row with before/after on every PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/plans/starter',
      headers: { authorization: `Bearer ${financeToken}` },
      payload: { name: 'Audited Starter Name' },
    });
    expect(res.statusCode).toBe(200);

    const row = await prisma.auditLog.findFirst({
      where: { action: 'plan.updated', targetType: 'plan', targetId: 'starter', actorId: financeAdminId },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect((row!.after as { name?: string }).name).toBe('Audited Starter Name');
    expect(row!.before).not.toBeNull();
  });
});
