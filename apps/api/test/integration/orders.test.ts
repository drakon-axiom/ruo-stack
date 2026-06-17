import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { appendEntry, captureOrder, getWalletSummary } from '../../src/services/wallet.js';
import { randomToken } from '../../src/crypto.js';

// Order ↔ wallet correctness (held/available + capture). Self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('order wallet (DB integration)', () => {
  let brandId: string;
  let productId: string;
  beforeAll(async () => {
    const b = await prisma.brand.create({ data: { brandName: 'Order WT', referralCode: `OW-${randomToken(5)}` } });
    brandId = b.id;
    const p = await prisma.catalogProduct.create({
      data: {
        canonicalSku: `OW-${randomToken(4)}`,
        compound: 'X',
        name: 'X',
        wholesaleStarter: 3705,
        wholesalePro: 3000,
        wholesaleVolume: 2500,
        suggestedRetail: 9000,
        isPublished: true,
      },
    });
    productId = p.id;
  });
  afterAll(async () => {
    await prisma.order.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.catalogProduct.delete({ where: { id: productId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('held reflects open orders; ship captures the balance; capture is idempotent', async () => {
    await appendEntry(prisma, { brandId, type: 'deposit', amount: 10_000, externalId: `ow_dep_${randomToken(4)}` });
    expect((await getWalletSummary(prisma, brandId)).available).toBe(10_000);

    const order = await prisma.order.create({
      data: {
        brandId,
        source: 'manual',
        status: 'ready_for_fulfillment',
        blocker: 'none',
        recipientName: 'Jane',
        address1: '1 Main',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        wholesaleTotalCents: 3705,
        shippingTotalCents: 1295,
        walletChargeCents: 5000,
        items: { create: [{ productId, qty: 1, unitWholesaleCents: 3705 }] },
      },
    });

    // Open order reserves funds.
    let s = await getWalletSummary(prisma, brandId);
    expect(s.held).toBe(5000);
    expect(s.available).toBe(5000);

    // Ship → capture + status shipped.
    await captureOrder(prisma, order);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'shipped' } });
    s = await getWalletSummary(prisma, brandId);
    expect(s.balance).toBe(5000);
    expect(s.held).toBe(0); // shipped no longer reserved
    expect(s.available).toBe(5000);

    // Idempotent: re-capturing the same order doesn't double-debit.
    await captureOrder(prisma, order);
    expect((await getWalletSummary(prisma, brandId)).balance).toBe(5000);
  });
});
