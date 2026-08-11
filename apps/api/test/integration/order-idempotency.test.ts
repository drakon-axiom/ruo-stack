import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, Prisma } from '@ruostack/db';
import { randomToken } from '../../src/crypto.ts';

// The unique index on (brand_id, source, external_order_id) is the DB backstop
// for store-order idempotency. Self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('order external-id idempotency (DB integration)', () => {
  let brandId: string;
  beforeAll(async () => {
    const b = await prisma.brand.create({ data: { brandName: 'Idem WT', referralCode: `IW-${randomToken(5)}` } });
    brandId = b.id;
  });
  afterAll(async () => {
    await prisma.order.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const base = {
    status: 'ready_for_fulfillment' as const,
    blocker: 'none' as const,
    recipientName: 'Jane',
    address1: '1 Main',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    wholesaleTotalCents: 1000,
    shippingTotalCents: 500,
    walletChargeCents: 1500,
  };

  it('rejects a second store order with the same (brand, source, external id)', async () => {
    const externalOrderId = `woo-${randomToken(5)}`;
    await prisma.order.create({ data: { brandId, source: 'woocommerce', externalOrderId, ...base } });

    let code: string | undefined;
    try {
      await prisma.order.create({ data: { brandId, source: 'woocommerce', externalOrderId, ...base } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) code = err.code;
    }
    expect(code).toBe('P2002'); // unique-constraint violation
  });

  it('allows many manual orders (NULL external id does not collide)', async () => {
    const a = await prisma.order.create({ data: { brandId, source: 'manual', ...base } });
    const b = await prisma.order.create({ data: { brandId, source: 'manual', ...base } });
    expect(a.id).not.toBe(b.id); // NULLs are distinct → no false idempotency
  });
});
