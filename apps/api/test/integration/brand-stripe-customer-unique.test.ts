import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma, Prisma } from '@ruostack/db';
import { randomToken } from '../../src/crypto.js';

// stripe_customer_id is the webhook tenant-lookup key; two brands must never
// share one, or a billing event misattributes. NULLs stay distinct. Self-skips
// unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('brand.stripe_customer_id uniqueness (DB integration)', () => {
  const created: string[] = [];
  afterAll(async () => {
    await prisma.brand.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function brand(stripeCustomerId: string | null) {
    const b = await prisma.brand.create({ data: { brandName: 'SC WT', referralCode: `SC-${randomToken(6)}`, stripeCustomerId } });
    created.push(b.id);
    return b;
  }

  it('rejects a second brand with the same stripe_customer_id', async () => {
    const cus = `cus_${randomToken(8)}`;
    await brand(cus);
    let code: string | undefined;
    try {
      await brand(cus);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) code = err.code;
    }
    expect(code).toBe('P2002');
  });

  it('allows multiple brands with no stripe_customer_id (NULLs are distinct)', async () => {
    const a = await brand(null);
    const b = await brand(null);
    expect(a.id).not.toBe(b.id);
  });
});
