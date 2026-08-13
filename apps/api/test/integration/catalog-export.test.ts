import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { IMPORT_COLUMNS, parseCsv } from '@ruostack/shared';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.ts';

// Catalog CSV export: permissions, filter pass-through, audit. Self-skips
// unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Export Admin',
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

describe.skipIf(!RUN)('catalog export (DB integration)', () => {
  let app: FastifyInstance;
  let token: string;
  let adminIds: string[] = [];
  const created: string[] = [];
  const tag = randomToken(6).toUpperCase();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const ops = await seedAdmin('operations');
    token = ops.token;
    adminIds = [ops.admin.id];

    for (const [i, status] of (['in_stock', 'soon'] as const).entries()) {
      const p = await prisma.catalogProduct.create({
        data: {
          canonicalSku: `RUO-EX${tag}-${i}`,
          compound: `EX${tag}`,
          name: `Export Test ${i}`,
          wholesaleStarter: 1000,
          wholesalePro: 900,
          wholesaleVolume: 800,
          suggestedRetail: 5000,
          status,
        },
      });
      created.push(p.id);
    }
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: adminIds } } }).catch(() => undefined);
    await prisma.catalogProduct.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  function get(url: string, bearer = token) {
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${bearer}` } });
  }

  it('refuses an unauthenticated request', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/catalog/export.csv' });
    expect(res.statusCode).toBe(401);
  });

  it('serves CSV with an attachment filename carrying the shape', async () => {
    const res = await get('/api/admin/catalog/export.csv?shape=import');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('ruostack-catalog-import-');
    expect(parseCsv(res.body).header).toEqual([...IMPORT_COLUMNS]);
  });

  it('defaults to the import shape when none is given', async () => {
    const res = await get('/api/admin/catalog/export.csv');
    expect(parseCsv(res.body).header).toEqual([...IMPORT_COLUMNS]);
  });

  it('passes the status filter through to the query', async () => {
    const all = await get(`/api/admin/catalog/export.csv?search=EX${tag}`);
    const oneStatus = await get(`/api/admin/catalog/export.csv?search=EX${tag}&status=in_stock`);
    expect(parseCsv(all.body).rows.length).toBe(2);
    expect(parseCsv(oneStatus.body).rows.length).toBe(1);
  });

  it('excludes archived products unless asked, matching the list route', async () => {
    // created[0] is the one about to be archived; created[1] stays live. Counts
    // alone can't tell "the archived one is filtered out" from "the filter never
    // reached the query" -- both scenarios return 1 row here -- so this asserts
    // which SKU is in each file, not just how many rows it has.
    const archivedSku = `RUO-EX${tag}-0`;
    const liveSku = `RUO-EX${tag}-1`;
    await prisma.catalogProduct.update({ where: { id: created[0]! }, data: { archived: true } });

    const normal = await get(`/api/admin/catalog/export.csv?search=EX${tag}`);
    const archived = await get(`/api/admin/catalog/export.csv?search=EX${tag}&archived=true`);
    const normalSkus = parseCsv(normal.body).rows.map((r) => r[0]);
    const archivedSkus = parseCsv(archived.body).rows.map((r) => r[0]);

    expect(normalSkus).toContain(liveSku);
    expect(normalSkus).not.toContain(archivedSku);
    expect(archivedSkus).toContain(archivedSku);
    expect(archivedSkus).not.toContain(liveSku);
    expect(normalSkus.length).toBe(1);
    expect(archivedSkus.length).toBe(1);

    await prisma.catalogProduct.update({ where: { id: created[0]! }, data: { archived: false } });
  });

  it('emits a header-only file when nothing matches', async () => {
    const res = await get('/api/admin/catalog/export.csv?search=NOSUCHPRODUCTXYZ');
    expect(res.statusCode).toBe(200);
    expect(parseCsv(res.body).rows).toEqual([]);
    expect(parseCsv(res.body).header).toEqual([...IMPORT_COLUMNS]);
  });

  it('writes one audit row per export, recording shape, count and filters', async () => {
    await get(`/api/admin/catalog/export.csv?shape=full&search=EX${tag}&status=soon`);
    const row = await prisma.auditLog.findFirst({
      where: { action: 'catalog.exported', actorId: adminIds[0] },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    const after = row!.after as Record<string, unknown>;
    expect(after.shape).toBe('full');
    expect(after.rows).toBe(1);
    const filters = after.filters as Record<string, unknown>;
    expect(filters.status).toBe('soon');
    expect(filters.search).toBe(`EX${tag}`);
    expect(filters.archived).toBe(false);
  });
});
