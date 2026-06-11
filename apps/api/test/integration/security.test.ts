import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, Prisma, type AdminRole } from '@ruostack/db';
import { buildApp } from '../../src/app.js';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.js';
import { hashToken, randomToken, hashPassword } from '../../src/crypto.js';

// These exercise the security spine against a REAL migrated Supabase Postgres.
// They self-skip unless RUN_DB_TESTS=1 (so `pnpm test` is green offline). To run:
//   RUN_DB_TESTS=1 DATABASE_URL=… DIRECT_URL=… pnpm --filter @ruostack/api test
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Test Admin',
      role,
      passwordHash: await hashPassword('x'),
      status: 'active',
      mfaEnabled: true,
    },
  });
  const refresh = randomToken(32);
  const session = await prisma.adminSession.create({
    data: { adminUserId: admin.id, refreshTokenHash: hashToken(refresh), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const token = signAdminAccessToken({ sub: admin.id, role, sid: session.id });
  return { admin, token };
}

describe.skipIf(!RUN)('security spine (DB integration)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('audit_log UPDATE and DELETE are rejected even via the bypassrls role (trigger)', async () => {
    const row = await prisma.auditLog.create({
      data: { actorType: 'system', action: 'test.entry', actorId: null },
    });
    await expect(
      prisma.$executeRaw`UPDATE audit_log SET action = 'tampered' WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}::uuid`).rejects.toThrow();
  });

  it('RLS is enabled on every public table (no table left unprotected)', async () => {
    const rows = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relrowsecurity = false
        AND c.relname <> '_prisma_migrations'`;
    expect(rows).toEqual([]);
  });

  it('catalog: create → audit; SKU change after publish → rejected; stock toggle → audit', async () => {
    const { token } = await seedAdmin('super_admin');
    const auth = { authorization: `Bearer ${token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/catalog',
      headers: auth,
      payload: { canonical_sku: `SKU-${randomToken(4)}`, compound: 'Test', name: 'Test', wholesale_cost: 1000, suggested_retail: 3000 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const audit = await prisma.auditLog.findFirst({ where: { action: 'catalog.created', targetId: id } });
    expect(audit).not.toBeNull();

    // Publish, then attempt a SKU change → must be rejected.
    expect((await app.inject({ method: 'POST', url: `/api/admin/catalog/${id}/publish`, headers: auth })).statusCode).toBe(200);
    const skuEdit = await app.inject({
      method: 'PATCH',
      url: `/api/admin/catalog/${id}`,
      headers: auth,
      payload: { canonical_sku: 'NEW-SKU' },
    });
    expect(skuEdit.statusCode).toBe(400);
    expect(skuEdit.json().error).toBe('sku_immutable');

    // Stock toggle audits.
    expect((await app.inject({ method: 'POST', url: `/api/admin/catalog/${id}/stock`, headers: auth, payload: { status: 'in_stock' } })).statusCode).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { action: 'sku.stock_changed', targetId: id } })).not.toBeNull();
  });

  it('an operations admin is 403 on a super_admin-only role-grant route', async () => {
    const ops = await seedAdmin('operations');
    const target = await seedAdmin('support');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/admins/${target.admin.id}/role`,
      headers: { authorization: `Bearer ${ops.token}` },
      payload: { role: 'finance' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('cross-realm: a garbage brand token cannot hit an admin route; an admin token cannot hit a brand route', async () => {
    const garbageBrand = await app.inject({ method: 'GET', url: '/api/admin/catalog', headers: { authorization: 'Bearer not-a-real-jwt' } });
    expect([401, 403]).toContain(garbageBrand.statusCode);

    const { token } = await seedAdmin('support');
    const adminOnBrand = await app.inject({ method: 'GET', url: '/api/brand/me', headers: { authorization: `Bearer ${token}` } });
    expect([401, 403]).toContain(adminOnBrand.statusCode);
  });

  it('signup atomicity: a failure mid-transaction leaves no brand-side rows', async () => {
    const code = `RUO-${randomToken(4)}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.brand.create({ data: { brandName: 'Doomed', referralCode: code } });
        throw new Error('forced failure mid-signup');
      }),
    ).rejects.toThrow();
    expect(await prisma.brand.findFirst({ where: { referralCode: code } })).toBeNull();
  });

  it('webhook idempotency: a duplicate (source, external_id) is rejected by the unique constraint', async () => {
    const externalId = `evt_${randomToken(6)}`;
    await prisma.webhookEvent.create({ data: { source: 'stripe', externalId, type: 'test', payload: {} } });
    await expect(
      prisma.webhookEvent.create({ data: { source: 'stripe', externalId, type: 'test', payload: {} } }),
    ).rejects.toMatchObject({ code: 'P2002' } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
  });
});
