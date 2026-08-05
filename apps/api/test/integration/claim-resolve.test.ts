import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { resolveClaim } from '../../src/services/claims.js';
import { HttpError } from '../../src/errors.js';
import { randomToken } from '../../src/crypto.js';

// Claim resolution must not double-ship: a second resolve of an already-resolved
// claim is rejected and creates no additional reship order. Self-skips unless
// RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('claim resolution idempotency (DB integration)', () => {
  let brandId: string;
  let productId: string;
  let adminId: string;

  beforeAll(async () => {
    const b = await prisma.brand.create({ data: { brandName: 'Claim WT', referralCode: `CW-${randomToken(5)}` } });
    brandId = b.id;
    const p = await prisma.catalogProduct.create({
      data: { canonicalSku: `CW-${randomToken(4)}`, compound: 'X', name: 'X', wholesaleStarter: 1000, wholesalePro: 900, wholesaleVolume: 800, suggestedRetail: 3000, isPublished: true },
    });
    productId = p.id;
    const admin = await prisma.adminUser.create({
      data: { email: `claim-${randomToken(5)}@test.local`, passwordHash: 'x', fullName: 'Op', role: 'operations' },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.claim.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.adminUser.delete({ where: { id: adminId } }).catch(() => undefined);
    await prisma.catalogProduct.delete({ where: { id: productId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function makeClaim(): Promise<string> {
    const order = await prisma.order.create({
      data: {
        brandId, source: 'manual', status: 'shipped', blocker: 'none',
        recipientName: 'Jane', address1: '1 Main', city: 'Austin', state: 'TX', zip: '78701',
        wholesaleTotalCents: 1000, shippingTotalCents: 500, walletChargeCents: 1500,
        items: { create: [{ productId, qty: 1, unitWholesaleCents: 1000 }] },
      },
    });
    const claim = await prisma.claim.create({
      data: { orderId: order.id, brandId, type: 'lost', openedByType: 'brand', slaDueAt: new Date() },
    });
    return claim.id;
  }

  it('reships once, then rejects a re-resolve without creating a second order', async () => {
    const claimId = await makeClaim();

    const resolved = await resolveClaim(prisma, claimId, { resolution: 'reshipped', reason: 'carrier lost', comp: true }, adminId);
    expect(resolved.status).toBe('resolved');
    expect(resolved.reshipOrderId).toBeTruthy();

    const reshipCountAfterFirst = await prisma.order.count({ where: { brandId, source: 'manual', status: 'ready_for_fulfillment' } });
    expect(reshipCountAfterFirst).toBe(1);

    // A second resolve is rejected as already-resolved …
    let status: number | undefined;
    try {
      await resolveClaim(prisma, claimId, { resolution: 'reshipped', reason: 'again', comp: true }, adminId);
    } catch (err) {
      if (err instanceof HttpError) status = err.statusCode;
    }
    expect(status).toBe(409);

    // … and no second reship order was created.
    const reshipCountAfterSecond = await prisma.order.count({ where: { brandId, source: 'manual', status: 'ready_for_fulfillment' } });
    expect(reshipCountAfterSecond).toBe(1);
  });
});
