import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { importWooOrder } from '../../src/services/store-intake.js';
import { randomToken } from '../../src/crypto.js';

// A successful import must clear a transient `error` but never resurrect a
// connection an admin deliberately `disabled`. Self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('store connection status on import (DB integration)', () => {
  let brandId: string;
  beforeAll(async () => {
    const b = await prisma.brand.create({ data: { brandName: 'Conn WT', referralCode: `CN-${randomToken(5)}` } });
    brandId = b.id;
  });
  afterAll(async () => {
    await prisma.order.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandStoreConnection.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function makeConn(status: 'active' | 'error' | 'disabled') {
    // Woo REST creds aren't decrypted for an order with no matchable lines (no
    // rating happens), so placeholder ciphertext is fine here.
    return prisma.brandStoreConnection.create({
      data: {
        brandId, platform: 'woocommerce', storeUrl: 'https://example.com',
        consumerKeyEnc: 'x', consumerSecretEnc: 'y', webhookSecret: randomToken(8),
        status, lastError: status === 'error' ? 'prior failure' : null,
      },
    });
  }

  it('does not reactivate a disabled connection', async () => {
    const conn = await makeConn('disabled');
    await importWooOrder(prisma, conn, { id: `d-${randomToken(5)}` }); // no lines/address → no network
    const after = await prisma.brandStoreConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(after.status).toBe('disabled');
    await prisma.brandStoreConnection.delete({ where: { id: conn.id } });
  });

  it('clears a transient error on a successful import', async () => {
    const conn = await makeConn('error');
    await importWooOrder(prisma, conn, { id: `e-${randomToken(5)}` });
    const after = await prisma.brandStoreConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(after.status).toBe('active');
    expect(after.lastError).toBeNull();
    await prisma.brandStoreConnection.delete({ where: { id: conn.id } });
  });
});
