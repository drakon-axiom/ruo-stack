import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { applyOrderEdit } from '../../src/services/order-edit.ts';
import { appendEntry } from '../../src/services/wallet.ts';
import { randomToken } from '../../src/crypto.ts';

// An order edit re-prices and re-reserves, but it must NOT clear a
// needs_mapping / needs_address blocker just because funds now cover the order —
// otherwise an unmapped/unaddressable order exports and ships. Self-skips unless
// RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('order edit blocker precedence (DB integration)', () => {
  let brandId: string;
  let productId: string;
  beforeAll(async () => {
    const b = await prisma.brand.create({ data: { brandName: 'Edit WT', referralCode: `EW-${randomToken(5)}` } });
    brandId = b.id;
    const p = await prisma.catalogProduct.create({
      data: { canonicalSku: `EW-${randomToken(4)}`, compound: 'X', name: 'X', wholesaleStarter: 1000, wholesalePro: 900, wholesaleVolume: 800, suggestedRetail: 3000, weight: 4, isPublished: true },
    });
    productId = p.id;
    await appendEntry(prisma, { brandId, type: 'deposit', amount: 1_000_000, externalId: `ew_${randomToken(4)}` }); // plenty of funds
  });
  afterAll(async () => {
    await prisma.order.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.catalogProduct.delete({ where: { id: productId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function makeOrder(over: { blocker: 'needs_mapping' | 'needs_address' | 'none'; unmatchedSkus?: string[]; address1?: string }) {
    return prisma.order.create({
      data: {
        brandId, source: 'woocommerce', status: 'ready_for_fulfillment',
        blocker: over.blocker, unmatchedSkus: over.unmatchedSkus ?? [],
        recipientName: 'Jane', address1: over.address1 ?? '1 Main', city: 'Austin', state: 'TX', zip: '78701',
        wholesaleTotalCents: 1000, shippingTotalCents: 500, walletChargeCents: 1500,
        items: { create: [{ productId, qty: 1, unitWholesaleCents: 1000 }] },
      },
      include: { items: true },
    });
  }

  it('keeps needs_mapping after an edit even when funds cover the order', async () => {
    const order = await makeOrder({ blocker: 'needs_mapping', unmatchedSkus: ['UNMATCHED-1'] });
    const updated = await applyOrderEdit(prisma, order, { items: [{ product_id: productId, qty: 2 }] }, { type: 'brand', id: brandId });
    expect(updated.blocker).toBe('needs_mapping');
  });

  it('keeps needs_address when the address is still incomplete', async () => {
    const order = await makeOrder({ blocker: 'needs_address', address1: '' });
    const updated = await applyOrderEdit(prisma, order, { recipient_phone: '555-0000' }, { type: 'brand', id: brandId });
    expect(updated.blocker).toBe('needs_address');
  });

  it('clears to none for a clean, funded order', async () => {
    const order = await makeOrder({ blocker: 'none' });
    const updated = await applyOrderEdit(prisma, order, { items: [{ product_id: productId, qty: 2 }] }, { type: 'brand', id: brandId });
    expect(updated.blocker).toBe('none');
  });
});
