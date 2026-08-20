import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPrisma } from '@ruostack/db';
import { randomToken } from '../../src/crypto.ts';
import { completeOnboarding } from '../../src/services/onboarding.ts';

/**
 * First-run tutorial state against a real DB. The HTTP layer can't be exercised
 * for the positive path — brand tokens are minted by Supabase and verified
 * against its JWKS — so this drives the service the route delegates to. The
 * route's auth gate is covered separately in Task 3.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('brand onboarding completion (DB integration)', () => {
  let brandId: string;
  const userId = randomUUID();

  beforeAll(async () => {
    const brand = await prisma.brand.create({
      data: { brandName: 'Onboarding Co', referralCode: `OB-${randomToken(5)}` },
    });
    brandId = brand.id;
    await prisma.userProfile.create({ data: { id: userId, fullName: 'New Brand Owner' } });
    await prisma.brandMember.create({
      data: { brandId, userId, role: 'owner', status: 'active' },
    });
    await prisma.brandUserRole.create({ data: { userId, brandId, realm: 'brand' } });
  });

  afterAll(async () => {
    await prisma.brandUserRole.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandMember.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.userProfile.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const readTimestamp = async () =>
    (await prisma.userProfile.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true },
    }))!.onboardingCompletedAt;

  it('a freshly created profile has not completed onboarding', async () => {
    expect(await readTimestamp()).toBeNull();
  });

  it('completing onboarding stamps the profile', async () => {
    const before = Date.now();
    const at = await completeOnboarding(prisma, userId);

    expect(at).toBeInstanceOf(Date);
    expect(at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await readTimestamp())!.getTime()).toBe(at.getTime());
  });

  it('completing a second time keeps the ORIGINAL timestamp', async () => {
    const first = await readTimestamp();
    expect(first).not.toBeNull();

    const again = await completeOnboarding(prisma, userId);

    // This is the guarantee that makes "Replay welcome tour" safe: replaying and
    // dismissing must not move the completion time and destroy the analytics.
    expect(again.getTime()).toBe(first!.getTime());
    expect((await readTimestamp())!.getTime()).toBe(first!.getTime());
  });

  it('rejects an unknown user id rather than silently creating a row', async () => {
    const ghost = randomUUID();
    await expect(completeOnboarding(prisma, ghost)).rejects.toThrow(/not found/i);
    expect(await prisma.userProfile.findUnique({ where: { id: ghost } })).toBeNull();
  });
});
