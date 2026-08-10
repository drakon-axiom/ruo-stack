import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { buildApp } from '../../src/app.js';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.js';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.js';

/**
 * CSV catalog import: preview → commit. Self-skips unless RUN_DB_TESTS=1.
 *
 * The invariants worth a database to prove: an import never publishes, a blank
 * cell never clears a stored value, a bad row never takes the good rows down
 * with it, and a commit never trusts a preview it did not just recompute.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

const HEADER = 'canonical_sku,name,compound,wholesale_starter,wholesale_pro,wholesale_volume,suggested_retail';
const line = (sku: string, name = 'Imported', s = '10.00', p = '9.00', v = '8.00', r = '20.00') =>
  `${sku},${name},Importolide,${s},${p},${v},${r}`;

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Import Admin',
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

describe.skipIf(!RUN)('catalog CSV import (DB integration)', () => {
  let app: FastifyInstance;
  let token: string;
  let supportToken: string;
  let adminIds: string[] = [];
  const skus: string[] = [];

  const sku = (tag: string): string => {
    const s = `RUO-IM${randomToken(5).toUpperCase()}-${tag}`;
    skus.push(s);
    return s;
  };

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
    const products = await prisma.catalogProduct.findMany({ where: { canonicalSku: { in: skus } }, select: { id: true } });
    const ids = products.map((p) => p.id);
    await prisma.auditLog.deleteMany({ where: { targetId: { in: ids } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: adminIds } } }).catch(() => undefined);
    await prisma.catalogProduct.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  const preview = (csv: string, tok = token) =>
    app.inject({ method: 'POST', url: '/api/admin/catalog/import/preview', headers: { authorization: `Bearer ${tok}` }, payload: { csv, filename: 'test.csv' } });

  const commit = (csv: string, digest: string, tok = token) =>
    app.inject({ method: 'POST', url: '/api/admin/catalog/import/commit', headers: { authorization: `Bearer ${tok}` }, payload: { csv, filename: 'test.csv', digest } });

  /** Preview then commit, asserting the preview succeeded. */
  async function run(csv: string) {
    const pre = await preview(csv);
    expect(pre.statusCode).toBe(200);
    const body = pre.json();
    const res = await commit(csv, body.digest);
    return { preview: body, commit: res };
  }

  const find = (s: string) => prisma.catalogProduct.findUnique({ where: { canonicalSku: s } });

  it('classifies a mixed file into create, update, unchanged and error', async () => {
    const fresh = sku('MIX1');
    const existingSku = sku('MIX2');
    await run(`${HEADER}\n${line(existingSku)}`);

    const res = await preview(
      [
        HEADER,
        line(fresh), // create
        line(existingSku, 'Imported', '10.00', '9.50'), // update — one price moved
        `${existingSku}xx,,Importolide,10.00,9.00,8.00,20.00`, // error — new SKU, blank name
      ].join('\n'),
    );
    expect(res.statusCode).toBe(200);
    const { summary, rows } = res.json();
    expect(summary).toMatchObject({ total: 3, create: 1, update: 1, error: 1 });
    expect(rows[1].changes).toEqual([{ field: 'wholesale_pro', from: 900, to: 950 }]);
  });

  it('creates products unpublished and out of the brand catalog', async () => {
    // The never-publishes invariant. A spreadsheet must not be able to make a
    // product visible to every brand.
    const s = sku('DRAFT');
    const { commit: res } = await run(`${HEADER}\n${line(s)}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.created).toBe(1);

    const p = await find(s);
    expect(p?.isPublished).toBe(false);
    expect(p?.status).toBe('soon');
    expect(p?.archived).toBe(false);
    expect(p?.wholesalePro).toBe(900); // dollars became cents
  });

  it('updates a published product without disturbing its publish or stock state', async () => {
    const s = sku('PUB');
    await run(`${HEADER}\n${line(s)}`);
    const created = await find(s);
    await prisma.catalogProduct.update({ where: { id: created!.id }, data: { isPublished: true, status: 'in_stock' } });

    const { commit: res } = await run(`${HEADER}\n${line(s, 'Imported', '10.00', '9.75')}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.updated).toBe(1);

    const after = await find(s);
    expect(after?.wholesalePro).toBe(975);
    expect(after?.isPublished).toBe(true);
    expect(after?.status).toBe('in_stock');
  });

  it('leaves a stored value alone when the cell is blank', async () => {
    const s = sku('BLANK');
    await run(`${HEADER},description_template\n${line(s)},Original description`);
    expect((await find(s))?.descriptionTemplate).toBe('Original description');

    const res = await preview(`canonical_sku,description_template\n${s},`);
    expect(res.json().summary.unchanged).toBe(1);
    expect((await find(s))?.descriptionTemplate).toBe('Original description');
  });

  it('imports the good rows even when one row is broken', async () => {
    const good1 = sku('GOOD1');
    const good2 = sku('GOOD2');
    const bad = sku('BAD');
    const csv = [HEADER, line(good1), `${bad},Broken,Importolide,10.00,9.005,8.00,20.00`, line(good2)].join('\n');

    const { preview: pre, commit: res } = await run(csv);
    expect(pre.summary).toMatchObject({ create: 2, error: 1 });
    expect(pre.rows[1].errors[0].field).toBe('wholesale_pro');
    expect(res.json().summary).toMatchObject({ created: 2, errors: 1 });

    expect(await find(good1)).not.toBeNull();
    expect(await find(good2)).not.toBeNull();
    expect(await find(bad)).toBeNull();
  });

  it('refuses both lines when one SKU appears twice in a file', async () => {
    const dup = sku('DUP');
    const { preview: pre, commit: res } = await run(`${HEADER}\n${line(dup)}\n${line(dup, 'Second')}`);
    expect(pre.summary.error).toBe(2);
    expect(res.json().summary.created).toBe(0);
    expect(await find(dup)).toBeNull();
  });

  it('refuses to touch an archived product', async () => {
    const s = sku('ARCH');
    await run(`${HEADER}\n${line(s)}`);
    const p = await find(s);
    await prisma.catalogProduct.update({ where: { id: p!.id }, data: { status: 'out_of_stock', archived: true } });

    const res = await preview(`${HEADER}\n${line(s, 'Renamed', '99.00')}`);
    expect(res.json().rows[0].errors[0].code).toBe('archived');

    const after = await find(s);
    expect(after?.name).toBe(p!.name);
    expect(after?.wholesaleStarter).toBe(p!.wholesaleStarter);
  });

  it('rejects a file carrying a status column instead of silently dropping it', async () => {
    const s = sku('STATUS');
    const res = await preview(`${HEADER},status\n${line(s)},in_stock`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('forbidden_column');
    expect(await find(s)).toBeNull();
  });

  it('denies both routes to a role without catalog write', async () => {
    const s = sku('ROLE');
    expect((await preview(`${HEADER}\n${line(s)}`, supportToken)).statusCode).toBe(403);
    expect((await commit(`${HEADER}\n${line(s)}`, 'x', supportToken)).statusCode).toBe(403);
  });

  it('audits each affected product as well as the import as a whole', async () => {
    const s = sku('AUDIT');
    await run(`${HEADER}\n${line(s)}`);
    const p = await find(s);

    const perProduct = await prisma.auditLog.findMany({ where: { targetType: 'catalog_product', targetId: p!.id } });
    expect(perProduct).toHaveLength(1);
    expect(perProduct[0]?.action).toBe('catalog.created');
    expect(perProduct[0]?.reason).toBe('csv_import');

    const aggregate = await prisma.auditLog.findMany({ where: { action: 'catalog.imported', actorId: { in: adminIds } } });
    expect(aggregate.length).toBeGreaterThan(0);
  });

  it('refuses a commit whose preview no longer matches the catalog', async () => {
    // Someone edited the price in the drawer while the operator was reviewing.
    // Committing a stale "New" as a blind overwrite is exactly the failure the
    // two-phase design exists to prevent.
    const s = sku('STALE');
    await run(`${HEADER}\n${line(s)}`);
    const csv = `${HEADER}\n${line(s, 'Imported', '10.00', '9.50')}`;

    const pre = await preview(csv);
    const digest = pre.json().digest;
    const p = await find(s);
    await prisma.catalogProduct.update({ where: { id: p!.id }, data: { wholesalePro: 1234 } });

    const res = await commit(csv, digest);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('preview_stale');
    expect(res.json().preview.rows[0].changes[0].from).toBe(1234);
    expect((await find(s))?.wholesalePro).toBe(1234); // nothing written
  });

  it('rejects a file with more rows than the importer accepts', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `RUO-BULK-${i},N,C,1.00,1.00,1.00,1.00`);
    const res = await preview([HEADER, ...rows].join('\n'));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('too_many_rows');
  });

  it('names the delimiter it found instead of guessing', async () => {
    const res = await preview('canonical_sku;name;compound\nA;B;C');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('bad_delimiter');
  });

  it('treats a header-only file as a valid empty import', async () => {
    const res = await preview(HEADER);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({ total: 0, create: 0, update: 0, error: 0 });
  });

  it('rejects an empty file', async () => {
    const res = await preview('   ');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('empty_file');
  });
});
