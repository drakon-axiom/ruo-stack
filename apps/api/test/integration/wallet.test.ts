import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { appendEntry, getBalance } from '../../src/services/wallet.js';
import { randomToken } from '../../src/crypto.js';

// Wallet ledger correctness against the real DB. Self-skips unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('wallet ledger (DB integration)', () => {
  let brandId: string;
  beforeAll(async () => {
    const b = await prisma.brand.create({ data: { brandName: 'Wallet Test', referralCode: `WT-${randomToken(5)}` } });
    brandId = b.id;
  });
  afterAll(async () => {
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined); // cascades wallet_ledger
    await prisma.$disconnect();
  });

  it('deposits accumulate; a replayed externalId is idempotent (no double-credit)', async () => {
    const first = await appendEntry(prisma, { brandId, type: 'deposit', amount: 5000, externalId: 'evt_w1' });
    expect(first.duplicate).toBe(false);
    expect(first.entry.balanceAfter).toBe(5000);
    expect(await getBalance(prisma, brandId)).toBe(5000);

    const replay = await appendEntry(prisma, { brandId, type: 'deposit', amount: 5000, externalId: 'evt_w1' });
    expect(replay.duplicate).toBe(true);
    expect(await getBalance(prisma, brandId)).toBe(5000); // unchanged

    const second = await appendEntry(prisma, { brandId, type: 'deposit', amount: 2500, externalId: 'evt_w2' });
    expect(second.entry.balanceAfter).toBe(7500);
  });

  it('running balance tracks debits and refuses to go negative', async () => {
    const adj = await appendEntry(prisma, { brandId, type: 'manual_adjustment', amount: -1000, reason: 'test' });
    expect(adj.entry.balanceAfter).toBe(6500);
    await expect(
      appendEntry(prisma, { brandId, type: 'capture', amount: -999_999 }),
    ).rejects.toThrow(/negative/);
    expect(await getBalance(prisma, brandId)).toBe(6500);
  });
});
