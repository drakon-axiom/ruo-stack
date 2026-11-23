import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { resolveClaim } from '../../src/services/claims.ts';
import { appendEntry, getBalance, getWalletSummary, lockBrandWallet } from '../../src/services/wallet.ts';
import { randomToken } from '../../src/crypto.ts';

const db = getPrisma();
// Both operations read the same pre-resolution state before either proceeds.
// All writes/locks/rollbacks still execute in PostgreSQL. Only the first read is
// synchronized, so transactional rechecks can run after acquiring the wallet lock.
function simultaneousReaders(count: number): PrismaClient[] {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>(r => { release = r; });
  return Array.from({ length: count }, () => {
    let first = true;
    return db.$extends({ query: { claim: { async findUnique({ args, query }) {
      const result = await query(args);
      if (first) { first = false; if (++arrived === count) release(); await ready; }
      return result;
    } } } }) as unknown as PrismaClient;
  });
}

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('claim financial atomicity', () => {
  let brandId: string;
  let adminId: string;
  let productId: string;
  let orderId: string;
  beforeEach(async () => {
    brandId = (await db.brand.create({ data: { brandName: 'Claim concurrency', referralCode: randomToken(10) } })).id;
    adminId = (await db.adminUser.create({ data: { email: `${randomToken(10)}@test.local`, passwordHash: 'unused', fullName: 'Claim operator', role: 'operations' } })).id;
    productId = (await db.catalogProduct.create({ data: { canonicalSku: randomToken(10), compound: 'X', name: 'X', wholesaleStarter: 1000, wholesalePro: 1000, wholesaleVolume: 1000, suggestedRetail: 2000 } })).id;
    orderId = (await db.order.create({ data: {
      brandId, source: 'manual', status: 'shipped', blocker: 'none', recipientName: 'Recipient', address1: '1 Main', city: 'Austin', state: 'TX', zip: '78701', country: 'US',
      wholesaleTotalCents: 1000, shippingTotalCents: 500, walletChargeCents: 1500,
      items: { create: [{ productId, qty: 1, unitWholesaleCents: 1000 }] },
    } })).id;
  });
  afterEach(async () => {
    await db.claim.deleteMany({ where: { brandId } });
    await db.order.deleteMany({ where: { brandId } });
    await db.brand.delete({ where: { id: brandId } });
    await db.catalogProduct.delete({ where: { id: productId } });
    await db.adminUser.delete({ where: { id: adminId } });
  });
  afterAll(async () => { await db.$disconnect(); });
  async function claim() { return db.claim.create({ data: { brandId, orderId, type: 'lost', openedByType: 'brand', slaDueAt: new Date() } }); }

  it.each(['denied', 'reshipped'] as const)('credit versus %s has only the winning outcome', async (resolution) => {
    const c = await claim();
    const [a, b] = simultaneousReaders(2);
    const results = await Promise.allSettled([
      resolveClaim(a!, c.id, { resolution: 'credited', reason: 'credit', amountCents: 700 }, adminId),
      resolveClaim(b!, c.id, { resolution, reason: 'other', comp: true }, adminId),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const stored = await db.claim.findUniqueOrThrow({ where: { id: c.id } });
    expect(await getBalance(db, brandId)).toBe(stored.resolution === 'credited' ? 700 : 0);
    expect(await db.order.count({ where: { brandId, status: 'ready_for_fulfillment' } })).toBe(stored.resolution === 'reshipped' ? 1 : 0);
    expect(await db.auditLog.count({ where: { targetId: c.id, action: 'claim.resolved' } })).toBe(1);
  });
  it('competing credit amounts agree with the winning claim metadata', async () => {
    const c = await claim();
    const [a, b] = simultaneousReaders(2);
    const results = await Promise.allSettled([
      resolveClaim(a!, c.id, { resolution: 'credited', reason: 'small', amountCents: 700 }, adminId),
      resolveClaim(b!, c.id, { resolution: 'credited', reason: 'large', amountCents: 1200 }, adminId),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const stored = await db.claim.findUniqueOrThrow({ where: { id: c.id } });
    expect(await getBalance(db, brandId)).toBe(stored.amountCents);
    expect(await db.walletLedger.count({ where: { brandId } })).toBe(1);
  });
  it('rolls back a credit when the claim audit cannot be written', async () => {
    const c = await claim();
    const broken = db.$extends({ query: { auditLog: { async create() { throw new Error('audit unavailable'); } } } }) as unknown as PrismaClient;
    await expect(resolveClaim(broken, c.id, { resolution: 'credited', reason: 'credit', amountCents: 700 }, adminId)).rejects.toThrow('audit unavailable');
    expect(await getBalance(db, brandId)).toBe(0);
    expect((await db.claim.findUniqueOrThrow({ where: { id: c.id } })).status).not.toBe('resolved');
    expect(await db.auditLog.count({ where: { targetId: c.id } })).toBe(0);
  });
  it('two charged reships cannot both reserve the same funds', async () => {
    await appendEntry(db, { brandId, type: 'deposit', amount: 1500 });
    const [first, second] = await Promise.all([claim(), claim()]);
    const [a, b] = simultaneousReaders(2);
    await Promise.all([
      resolveClaim(a!, first.id, { resolution: 'reshipped', reason: 'first', comp: false }, adminId),
      resolveClaim(b!, second.id, { resolution: 'reshipped', reason: 'second', comp: false }, adminId),
    ]);
    const orders = await db.order.findMany({ where: { brandId, status: 'ready_for_fulfillment' } });
    expect(orders.map(o => o.blocker).sort()).toEqual(['awaiting_funds', 'none']);
    expect(await getWalletSummary(db, brandId)).toEqual({ balance: 1500, held: 1500, available: 0 });
  });
  it('charged reship respects funds reserved by a concurrent ordinary order', async () => {
    await appendEntry(db, { brandId, type: 'deposit', amount: 1500 });
    const c = await claim();
    let sawClaim!: () => void;
    const read = new Promise<void>(r => { sawClaim = r; });
    const reader = db.$extends({ query: { claim: { async findUnique({ args, query }) {
      const result = await query(args); sawClaim(); return result;
    } } } }) as unknown as PrismaClient;
    let reship!: ReturnType<typeof resolveClaim>;
    await db.$transaction(async tx => {
      await lockBrandWallet(tx, brandId);
      reship = resolveClaim(reader, c.id, { resolution: 'reshipped', reason: 'replacement', comp: false }, adminId);
      await read;
      // Reserve using exactly the lock/read/create boundary used by normal orders.
      const original = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const { id: _id, sourceItems: _sourceItems, ...data } = original;
      await tx.order.create({ data: { ...data, status: 'ready_for_fulfillment', shippedAt: null } });
    });
    const result = await reship;
    expect((await db.order.findUniqueOrThrow({ where: { id: result.reshipOrderId! } })).blocker).toBe('awaiting_funds');
    expect((await getWalletSummary(db, brandId)).available).toBe(0);
  });
  it('concurrent identical ledger references credit once', async () => {
    const input = { brandId, type: 'deposit' as const, amount: 700, externalId: randomToken(12) };
    const entries = await Promise.all([appendEntry(db, input), appendEntry(db, input)]);
    expect(entries.map(e => e.duplicate).sort()).toEqual([false, true]);
    expect(await getBalance(db, brandId)).toBe(700);
    expect(await db.walletLedger.count({ where: { brandId } })).toBe(1);
  });
  it('a global ledger reference cannot be reused across brands', async () => {
    const other = await db.brand.create({ data: { brandName: 'Other wallet', referralCode: randomToken(12) } });
    try {
      const externalId = randomToken(12);
      const results = await Promise.allSettled([
        appendEntry(db, { brandId, type: 'deposit', amount: 700, externalId }),
        appendEntry(db, { brandId: other.id, type: 'deposit', amount: 700, externalId }),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
      expect(loser.reason.code).toBe('ledger_replay_conflict');
      expect(await getBalance(db, brandId) + await getBalance(db, other.id)).toBe(700);
    } finally { await db.brand.delete({ where: { id: other.id } }); }
  });
  it('a replay with different money parameters is rejected', async () => {
    const externalId = randomToken(12);
    await appendEntry(db, { brandId, type: 'deposit', amount: 700, externalId });
    await expect(appendEntry(db, { brandId, type: 'deposit', amount: 900, externalId })).rejects.toThrow();
    await expect(appendEntry(db, { brandId, type: 'refund_credit', amount: 700, externalId })).rejects.toThrow();
    expect(await getBalance(db, brandId)).toBe(700);
  });
});
