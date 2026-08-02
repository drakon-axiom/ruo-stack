import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { buildApp } from '../../src/app.js';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.js';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.js';

// Catalog lifecycle: create → publish → unpublish → archive → restore, plus the
// delete guard. Self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Catalog Admin',
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

describe.skipIf(!RUN)('catalog CRUD + lifecycle (DB integration)', () => {
  let app: FastifyInstance;
  let token: string;
  let supportToken: string;
  let adminIds: string[] = [];
  const created: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const ops = await seedAdmin('operations');
    const sup = await seedAdmin('support');
    token = ops.token;
    supportToken = sup.token;
    adminIds = [ops.admin.id, sup.admin.id];
  });

  afterAll(async () => {
    await prisma.catalogProduct.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  async function makeProduct(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/catalog',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        canonical_sku: `RUO-CT${randomToken(5).toUpperCase()}-10MG`,
        compound: 'CT',
        name: 'Catalog CRUD Test',
        wholesale_starter: 1000,
        wholesale_pro: 900,
        wholesale_volume: 800,
        suggested_retail: 5000,
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    created.push(id);
    return id;
  }

  const post = (id: string, action: string, tok = token) =>
    app.inject({ method: 'POST', url: `/api/admin/catalog/${id}/${action}`, headers: { authorization: `Bearer ${tok}` } });
  const setStock = (id: string, status: string) =>
    app.inject({ method: 'POST', url: `/api/admin/catalog/${id}/stock`, headers: { authorization: `Bearer ${token}` }, payload: { status } });
  const del = (id: string, tok = token) =>
    app.inject({ method: 'DELETE', url: `/api/admin/catalog/${id}`, headers: { authorization: `Bearer ${tok}` } });

  it('deletes a never-published draft outright', async () => {
    const id = await makeProduct();
    expect((await del(id)).statusCode).toBe(200);
    expect(await prisma.catalogProduct.findUnique({ where: { id } })).toBeNull();
  });

  it('refuses to delete a published product and says to archive instead', async () => {
    const id = await makeProduct();
    await post(id, 'publish');

    const res = await del(id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('delete_blocked');
    expect(res.json().message).toMatch(/archive/i);
    expect(await prisma.catalogProduct.findUnique({ where: { id } })).not.toBeNull();
  });

  it('unpublish reverses publish and is idempotent', async () => {
    const id = await makeProduct();
    await post(id, 'publish');
    expect((await prisma.catalogProduct.findUniqueOrThrow({ where: { id } })).isPublished).toBe(true);

    const first = await post(id, 'unpublish');
    expect(first.statusCode).toBe(200);
    expect((await prisma.catalogProduct.findUniqueOrThrow({ where: { id } })).isPublished).toBe(false);

    expect((await post(id, 'unpublish')).statusCode).toBe(200); // no-op, not an error
  });

  it('refuses to archive until the product is out of stock', async () => {
    const id = await makeProduct();
    await post(id, 'publish');
    await setStock(id, 'in_stock');

    const refused = await post(id, 'archive');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('not_out_of_stock');
    expect((await prisma.catalogProduct.findUniqueOrThrow({ where: { id } })).archived).toBe(false);

    // Out of stock first — which is what pulls it from brand storefronts.
    await setStock(id, 'out_of_stock');
    const ok = await post(id, 'archive');
    expect(ok.statusCode).toBe(200);
    expect((await prisma.catalogProduct.findUniqueOrThrow({ where: { id } })).archived).toBe(true);
  });

  it('archived products drop out of the default admin list and appear under ?archived=true', async () => {
    const id = await makeProduct();
    await setStock(id, 'out_of_stock');
    await post(id, 'archive');

    const live = await app.inject({ method: 'GET', url: '/api/admin/catalog', headers: { authorization: `Bearer ${token}` } });
    expect(live.json().products.map((p: { id: string }) => p.id)).not.toContain(id);

    const archived = await app.inject({ method: 'GET', url: '/api/admin/catalog?archived=true', headers: { authorization: `Bearer ${token}` } });
    expect(archived.json().products.map((p: { id: string }) => p.id)).toContain(id);
  });

  it('restores from archive without silently putting it back on sale', async () => {
    const id = await makeProduct();
    await post(id, 'publish');
    await setStock(id, 'out_of_stock');
    await post(id, 'archive');

    expect((await post(id, 'unarchive')).statusCode).toBe(200);
    const p = await prisma.catalogProduct.findUniqueOrThrow({ where: { id } });
    expect(p.archived).toBe(false);
    expect(p.status).toBe('out_of_stock'); // operator re-stocks deliberately
  });

  it('locks the SKU while published', async () => {
    const id = await makeProduct();
    await post(id, 'publish');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/catalog/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { canonical_sku: `RUO-REN${randomToken(4).toUpperCase()}-10MG` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('sku_immutable');
  });

  it('keeps the SKU locked after unpublish when a brand store still carries it', async () => {
    // Unpublishing does not remove the product from storefronts, so renaming its
    // SKU would silently break order matching for a store that still has it.
    const id = await makeProduct();
    await post(id, 'publish');
    await post(id, 'unpublish');

    const brand = await prisma.brand.create({ data: { brandName: 'SKU Lock Co', referralCode: `SL-${randomToken(5)}` } });
    const conn = await prisma.brandStoreConnection.create({
      data: {
        brandId: brand.id,
        platform: 'woocommerce',
        storeUrl: 'https://example.test',
        consumerKeyEnc: 'x',
        consumerSecretEnc: 'y',
        webhookSecret: randomToken(16),
      },
    });
    await prisma.productProvisioning.create({
      data: { brandId: brand.id, connectionId: conn.id, catalogProductId: id, wooProductId: 5150, provisionedSku: 'RUO-X' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/catalog/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { canonical_sku: `RUO-REN${randomToken(4).toUpperCase()}-10MG` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('sku_immutable');
    expect(res.json().message).toMatch(/brand store/i);

    await prisma.productProvisioning.deleteMany({ where: { brandId: brand.id } });
    await prisma.brand.delete({ where: { id: brand.id } });
  });

  it('allows renaming an unpublished SKU that nothing references yet', async () => {
    const id = await makeProduct();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/catalog/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { canonical_sku: `RUO-FRESH${randomToken(4).toUpperCase()}-10MG` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('support cannot mutate the catalog (view-only surface)', async () => {
    const id = await makeProduct();
    expect((await post(id, 'publish', supportToken)).statusCode).toBe(403);
    expect((await del(id, supportToken)).statusCode).toBe(403);
  });

  it('audits every lifecycle transition', async () => {
    const id = await makeProduct();
    await post(id, 'publish');
    await post(id, 'unpublish');
    await setStock(id, 'out_of_stock');
    await post(id, 'archive');
    await post(id, 'unarchive');

    const actions = (await prisma.auditLog.findMany({ where: { targetType: 'catalog_product', targetId: id }, orderBy: { createdAt: 'asc' } })).map((e) => e.action);
    expect(actions).toContain('catalog.published');
    expect(actions).toContain('catalog.unpublished');
    expect(actions).toContain('catalog.archived');
    expect(actions).toContain('catalog.unarchived');
  });
});
