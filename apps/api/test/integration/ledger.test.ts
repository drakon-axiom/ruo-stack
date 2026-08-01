import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { buildApp } from '../../src/app.js';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.js';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.js';
import { appendEntry } from '../../src/services/wallet.js';

// Ledger & Reconciliation surface. Self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Ledger Admin',
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

describe.skipIf(!RUN)('ledger & reconciliation (DB integration)', () => {
  let app: FastifyInstance;
  let financeToken: string;
  let opsToken: string;
  let supportToken: string;
  let adminIds: string[] = [];
  let brandId: string;
  let productId: string;
  let orderId: string;
  const charge = 4_200;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const fin = await seedAdmin('finance');
    const ops = await seedAdmin('operations');
    const sup = await seedAdmin('support');
    financeToken = fin.token;
    opsToken = ops.token;
    supportToken = sup.token;
    adminIds = [fin.admin.id, ops.admin.id, sup.admin.id];

    const brand = await prisma.brand.create({ data: { brandName: 'Ledger Co', referralCode: `LG-${randomToken(5)}` } });
    brandId = brand.id;
    const cat = await prisma.catalogProduct.create({
      data: {
        canonicalSku: `RUO-LG${randomToken(4).toUpperCase()}-10MG`,
        compound: 'LG',
        name: 'Ledger Test 10mg',
        wholesaleStarter: 1000,
        wholesalePro: 900,
        wholesaleVolume: 800,
        suggestedRetail: 5000,
        isPublished: true,
      },
    });
    productId = cat.id;

    await appendEntry(prisma, { brandId, type: 'deposit', amount: 20_000, externalId: `lg_dep_${randomToken(5)}` });

    // A shipped order whose wallet was never captured — the drift case.
    const order = await prisma.order.create({
      data: {
        brandId,
        source: 'manual',
        status: 'shipped',
        blocker: 'none',
        recipientName: 'Drift Case',
        address1: '1 Main',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        wholesaleTotalCents: 3_000,
        shippingTotalCents: 1_200,
        walletChargeCents: charge,
        shippedAt: new Date(),
        items: { create: [{ productId, qty: 1, unitWholesaleCents: 3_000 }] },
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.walletLedger.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.catalogProduct.delete({ where: { id: productId } }).catch(() => undefined);
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const healAs = (token: string) =>
    app.inject({ method: 'POST', url: '/api/admin/ledger/heal/capture', headers: { authorization: `Bearer ${token}` }, payload: { order_id: orderId } });

  it('finance can read the ledger; support cannot (ledger surface is none for support)', async () => {
    expect((await get('/api/admin/ledger', financeToken)).statusCode).toBe(200);
    expect((await get('/api/admin/ledger', supportToken)).statusCode).toBe(403);
  });

  it('returns the brand’s entries with running balances', async () => {
    const res = await get(`/api/admin/ledger?brand_id=${brandId}`, financeToken);
    const { entries } = res.json();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].brandName).toBe('Ledger Co');
    expect(entries[0].balanceAfter).toBe(20_000);
  });

  it('summary reports the float and per-brand movement', async () => {
    const res = await get(`/api/admin/ledger/summary?brand_id=${brandId}`, financeToken);
    const body = res.json();
    expect(body.wallet_float_cents).toBeGreaterThanOrEqual(20_000);
    const mine = body.brands.find((b: { brandId: string }) => b.brandId === brandId);
    expect(mine.net).toBe(20_000);
    expect(mine.byType.deposit).toBe(20_000);
  });

  it('exports CSV in both shapes', async () => {
    const detail = await get(`/api/admin/ledger/export.csv?brand_id=${brandId}&shape=detail`, financeToken);
    expect(detail.statusCode).toBe(200);
    expect(detail.headers['content-type']).toContain('text/csv');
    expect(detail.body).toContain('Balance after');
    expect(detail.body).toContain('200.00');

    const summary = await get(`/api/admin/ledger/export.csv?brand_id=${brandId}&shape=summary`, financeToken);
    expect(summary.body).toContain('Ledger Co');
    expect(summary.body).toContain('Closing balance');
  });

  it('surfaces the shipped-but-not-captured order as drift', async () => {
    const res = await get('/api/admin/ledger/drift', financeToken);
    const finding = res.json().drift.find((d: { order_id: string }) => d.order_id === orderId);
    expect(finding).toBeTruthy();
    expect(finding.kind).toBe('shipped_not_captured');
  });

  it('operations has view but NOT write — the heal moves money, so it is finance-gated', async () => {
    expect((await get('/api/admin/ledger', opsToken)).statusCode).toBe(200);
    expect((await healAs(opsToken)).statusCode).toBe(403);
  });

  it('heals the drift by capturing, and is IDEMPOTENT on a second click', async () => {
    const before = await prisma.walletLedger.count({ where: { brandId, type: 'capture' } });

    const first = await healAs(financeToken);
    expect(first.statusCode).toBe(200);
    expect(first.json().already_captured).toBe(false);
    expect(first.json().captured_cents).toBe(charge);

    const after = await prisma.walletLedger.count({ where: { brandId, type: 'capture' } });
    expect(after).toBe(before + 1);

    // Double-click: the unique externalId means one capture, not two.
    const second = await healAs(financeToken);
    expect(second.statusCode).toBe(200);
    expect(second.json().already_captured).toBe(true);
    expect(await prisma.walletLedger.count({ where: { brandId, type: 'capture' } })).toBe(after);
  });

  it('the heal drops the order out of the drift report', async () => {
    const res = await get('/api/admin/ledger/drift', financeToken);
    expect(res.json().drift.find((d: { order_id: string }) => d.order_id === orderId)).toBeUndefined();
  });

  it('writes an audit entry naming the actor', async () => {
    const entries = await prisma.auditLog.findMany({ where: { targetType: 'order', targetId: orderId, action: 'reconciliation.capture_healed' } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.actorType).toBe('admin');
  });

  it('refuses to capture an order that has not shipped', async () => {
    const unshipped = await prisma.order.create({
      data: {
        brandId,
        source: 'manual',
        status: 'ready_for_fulfillment',
        blocker: 'none',
        recipientName: 'Not shipped',
        address1: '1 Main',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        wholesaleTotalCents: 1_000,
        shippingTotalCents: 500,
        walletChargeCents: 1_500,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ledger/heal/capture',
      headers: { authorization: `Bearer ${financeToken}` },
      payload: { order_id: unshipped.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('not_shipped');
  });
});
