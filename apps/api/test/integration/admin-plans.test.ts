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
// it in afterAll. Never touches `plan_price`.
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
  });

  afterAll(async () => {
    // Restore starter exactly as found, regardless of which test last wrote it.
    await prisma.plan
      .update({
        where: { key: 'starter' },
        data: {
          name: originalStarter.name,
          features: originalStarter.features,
          shippingCutoff: originalStarter.shippingCutoff,
          updatedBy: null,
        },
      })
      .catch(() => undefined);
    invalidatePlanRegistry();
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
