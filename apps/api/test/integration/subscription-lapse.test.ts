import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { LAPSE_GRACE_DAYS, effectivePlan, sweepLapsedSubscriptions, upsertSubscriptionState } from '../../src/services/subscription.ts';
import { randomToken } from '../../src/crypto.ts';

/**
 * The lapse sweep against a real DB. The pure rule is covered in the unit test;
 * what matters here is that the sweep's QUERY selects the right rows and that
 * the row it writes actually stops entitling the brand — including the coarse
 * `brand.subscription_status` mirror that other screens read.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();
const day = 86_400_000;
const brandIds: string[] = [];

async function makeBrand(name: string, over: { status: 'active' | 'past_due' | 'cancelled'; endOffsetDays: number | null }) {
  const brand = await prisma.brand.create({ data: { brandName: name, referralCode: `LP-${randomToken(5)}` } });
  brandIds.push(brand.id);
  await upsertSubscriptionState(prisma, {
    brandId: brand.id,
    status: over.status,
    plan: 'pro',
    currentPeriodEnd: over.endOffsetDays === null ? null : new Date(Date.now() + over.endOffsetDays * day),
  });
  return brand.id;
}

const stateOf = (brandId: string) =>
  prisma.subscriptionState.findUnique({
    where: { brandId },
    select: { plan: true, status: true, currentPeriodEnd: true },
  });

describe.skipIf(!RUN)('subscription lapse sweep (DB integration)', () => {
  let lapsed: string;
  let inGrace: string;
  let current: string;
  let openEnded: string;
  let alreadyCancelled: string;

  beforeAll(async () => {
    lapsed = await makeBrand('Lapsed Co', { status: 'active', endOffsetDays: -(LAPSE_GRACE_DAYS + 20) });
    inGrace = await makeBrand('In Grace Co', { status: 'active', endOffsetDays: -1 });
    current = await makeBrand('Paid Up Co', { status: 'active', endOffsetDays: 30 });
    openEnded = await makeBrand('Comped Co', { status: 'active', endOffsetDays: null });
    alreadyCancelled = await makeBrand('Gone Co', { status: 'cancelled', endOffsetDays: -100 });
  });

  afterAll(async () => {
    // audit_log is append-only, so the sweep's entries stay — targetId is a
    // loose reference and doesn't block deleting the brand.
    await prisma.subscriptionState.deleteMany({ where: { brandId: { in: brandIds } } }).catch(() => undefined);
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('entitlement is already withdrawn before the sweep even runs', async () => {
    // The sweep makes the STORED row honest; it is not what protects features.
    expect(effectivePlan(await stateOf(lapsed))).toBe('starter');
    expect(effectivePlan(await stateOf(inGrace))).toBe('pro');
  });

  it('expires exactly the subscriptions past the grace margin', async () => {
    const r = await sweepLapsedSubscriptions(prisma);
    expect(r.suspended).toBeGreaterThanOrEqual(1);

    // `expired`, not `suspended`: nothing is locked, the brand is on Starter.
    // Account-level suspension (brand.status) is an admin action for cause and
    // is the only one that denies requests — see guards.ts.
    expect((await stateOf(lapsed))!.status).toBe('expired');
    expect((await stateOf(inGrace))!.status).toBe('active');
    expect((await stateOf(current))!.status).toBe('active');
    expect((await stateOf(openEnded))!.status).toBe('active');
  });

  it('leaves the plan tier intact so the brand can be restored by paying', async () => {
    expect((await stateOf(lapsed))!.plan).toBe('pro');
  });

  it('clears the coarse brand.subscription_status mirror the other screens read', async () => {
    const b = await prisma.brand.findUnique({ where: { id: lapsed }, select: { subscriptionStatus: true } });
    expect(b!.subscriptionStatus).toBe('none');
  });

  it('does NOT suspend the account — an expired plan is not enforcement', async () => {
    // The whole point of the `expired` split. brand.status is what `requireBrand`
    // reads to 403 every request; a lapsed payment must never touch it.
    const b = await prisma.brand.findUnique({ where: { id: lapsed }, select: { status: true } });
    expect(b!.status).toBe('active');
  });

  it('writes an audit entry naming the reason', async () => {
    const entry = await prisma.auditLog.findFirst({
      where: { targetId: lapsed, targetType: 'brand' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect((entry!.after as { reason?: string }).reason).toBe('paid_through_lapsed');
  });

  it('is idempotent — a second pass finds nothing left to do', async () => {
    const again = await sweepLapsedSubscriptions(prisma);
    expect(again.examined).toBe(0);
  });

  it('does not resurrect or re-touch an already-cancelled subscription', async () => {
    expect((await stateOf(alreadyCancelled))!.status).toBe('cancelled');
  });

  it('recording a manual payment restores entitlement with no gateway involved', async () => {
    // The non-gateway half: a bank transfer an admin recorded pushes the same
    // paid-through field, and everything downstream just works.
    await upsertSubscriptionState(prisma, {
      brandId: lapsed,
      status: 'active',
      plan: 'pro',
      currentPeriodEnd: new Date(Date.now() + 30 * day),
    });
    expect(effectivePlan(await stateOf(lapsed))).toBe('pro');

    const after = await sweepLapsedSubscriptions(prisma);
    expect(after.examined).toBe(0); // and the sweep leaves it alone
    expect((await stateOf(lapsed))!.status).toBe('active');
  });
});
