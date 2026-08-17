import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole, type CatalogStatus } from '@ruostack/db';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.ts';

// Bulk catalog lifecycle: partial success, per-item audit, idempotency.
// Self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Bulk Admin',
      role,
      passwordHash: await hashPassword('x'),
      status: 'active',
      mfaEnabled: true,
    },
  });
  const session = await prisma.adminSession.create({
    data: {
      adminUserId: admin.id,
      refreshTokenHash: hashToken(randomToken(32)),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { admin, token: signAdminAccessToken({ sub: admin.id, role, sid: session.id }) };
}

describe.skipIf(!RUN)('bulk catalog lifecycle (DB integration)', () => {
  let app: FastifyInstance;
  let token: string;
  let viewerToken: string;
  const adminIds: string[] = [];
  let created: string[] = [];
  const tag = randomToken(6).toUpperCase();

  /** Fresh products per test, so ordering between cases cannot matter. */
  async function seedProducts(specs: { status: CatalogStatus; isPublished?: boolean }[]) {
    const ids: string[] = [];
    for (const [i, s] of specs.entries()) {
      const p = await prisma.catalogProduct.create({
        data: {
          canonicalSku: `RUO-BK${tag}-${randomToken(4)}-${i}`,
          compound: `BK${tag}`,
          name: `Bulk Test ${i}`,
          wholesaleStarter: 1000,
          wholesalePro: 900,
          wholesaleVolume: 800,
          suggestedRetail: 5000,
          status: s.status,
          isPublished: s.isPublished ?? false,
        },
      });
      ids.push(p.id);
      created.push(p.id);
    }
    return ids;
  }

  function bulk(body: unknown, bearer = token) {
    return app.inject({
      method: 'POST',
      url: '/api/admin/catalog/bulk',
      headers: { authorization: `Bearer ${bearer}` },
      payload: body as Record<string, unknown>,
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const ops = await seedAdmin('operations');
    token = ops.token;
    adminIds.push(ops.admin.id);
    const support = await seedAdmin('support');
    viewerToken = support.token;
    adminIds.push(support.admin.id);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: adminIds } } }).catch(() => undefined);
    await prisma.catalogProduct.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    created = [];
    await app.close();
    await prisma.$disconnect();
  });

  it('refuses an unauthenticated request', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/catalog/bulk', payload: { ids: [], action: 'publish' } });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a role without catalog write', async () => {
    const [id] = await seedProducts([{ status: 'in_stock' }]);
    const res = await bulk({ ids: [id], action: 'publish' }, viewerToken);
    expect(res.statusCode).toBe(403);
  });

  it('publishes a selection and reports each item', async () => {
    const ids = await seedProducts([{ status: 'in_stock' }, { status: 'soon' }]);
    const res = await bulk({ ids, action: 'publish' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(2);
    expect(body.failed).toBe(0);
    const rows = await prisma.catalogProduct.findMany({ where: { id: { in: ids } } });
    expect(rows.every((r) => r.isPublished)).toBe(true);
  });

  // The whole point of per-item outcomes: archive is gated on out_of_stock, so a
  // mixed selection half-succeeds and the refusal must not roll back the rest.
  it('archives what it can and reports why the rest was refused', async () => {
    const ids = await seedProducts([{ status: 'out_of_stock' }, { status: 'in_stock' }]);
    const body = (await bulk({ ids, action: 'archive' })).json();

    expect(body.applied).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r: { id: string }) => r.id === ids[1]).reason).toBe('not_out_of_stock');

    const rows = await prisma.catalogProduct.findMany({ where: { id: { in: ids } }, orderBy: { canonicalSku: 'asc' } });
    expect(rows.find((r) => r.id === ids[0])!.archived).toBe(true);
    expect(rows.find((r) => r.id === ids[1])!.archived).toBe(false);
  });

  it('reports an unknown id without failing the rest of the batch', async () => {
    const ids = await seedProducts([{ status: 'in_stock' }]);
    const missing = '11111111-1111-4111-8111-111111111111';
    const body = (await bulk({ ids: [...ids, missing], action: 'publish' })).json();

    expect(body.applied).toBe(1);
    expect(body.failed).toBe(1);
    expect(body.results.find((r: { id: string }) => r.id === missing).reason).toBe('not_found');
  });

  it('is a no-op on re-run rather than double-writing', async () => {
    const ids = await seedProducts([{ status: 'in_stock' }]);
    const first = (await bulk({ ids, action: 'publish' })).json();
    const second = (await bulk({ ids, action: 'publish' })).json();

    expect(first.applied).toBe(1);
    expect(second.applied).toBe(0);
    expect(second.unchanged).toBe(1);

    const audits = await prisma.auditLog.count({
      where: { targetType: 'catalog_product', targetId: ids[0], action: 'catalog.published' },
    });
    expect(audits).toBe(1);
  });

  // One row per product, not one per batch: AuditLog.targetId is how "what
  // happened to this SKU" gets answered.
  it('writes one audit row per product changed', async () => {
    const ids = await seedProducts([{ status: 'in_stock' }, { status: 'in_stock' }]);
    await bulk({ ids, action: 'set_stock', status: 'out_of_stock' });

    const audits = await prisma.auditLog.findMany({
      where: { targetType: 'catalog_product', targetId: { in: ids }, action: 'sku.stock_changed' },
    });
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((a) => a.targetId))).toEqual(new Set(ids));

    const rows = await prisma.catalogProduct.findMany({ where: { id: { in: ids } } });
    expect(rows.every((r) => r.status === 'out_of_stock')).toBe(true);
  });

  it('rejects a batch larger than the cap before touching anything', async () => {
    const ids = Array.from({ length: 101 }, () => '11111111-1111-4111-8111-111111111111');
    expect((await bulk({ ids, action: 'publish' })).statusCode).toBe(400);
  });

  it('rejects a status paired with an action that ignores it', async () => {
    const ids = await seedProducts([{ status: 'in_stock' }]);
    expect((await bulk({ ids, action: 'publish', status: 'out_of_stock' })).statusCode).toBe(400);
  });
});
