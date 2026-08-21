import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import type { NormalizedEvent } from '@ruostack/shared';
import { dispatchStripeEvent } from '../../src/routes/webhook.ts';
import { scanDrift } from '../../src/services/reconciliation.ts';
import { randomToken } from '../../src/crypto.ts';

/**
 * Task 8a: a Stripe price rotated for an EXISTING brand from the Stripe
 * Dashboard (never touching `plan_price`) leaves `upsertSubscriptionState`'s
 * update path with the stored tier untouched — the brand keeps paying one
 * tier's subscription while every order line snapshots the WRONG tier's
 * wholesale cost, baked into an immutable order record. This suite covers
 * the two pieces that close the gap:
 *   1. webhook.ts now persists `stripePriceId` on SubscriptionState (it used
 *      to resolve the tier from it and then discard the id itself).
 *   2. `scanDrift()` flags a `plan_price_mismatch` when a row's stripePriceId
 *      has no `plan_price` match, or its match disagrees with the stored plan.
 *
 * Only INSERTS new rows (throwaway brands, archived plan_price rows, and —
 * for the last two tests — a throwaway order) and never mutates an existing
 * row, so there is nothing to snapshot/restore — only to delete in afterAll.
 * Self-skips unless RUN_DB_TESTS=1.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

const brandIds: string[] = [];
const planPriceIds: string[] = [];
const orderIds: string[] = [];
const productIds: string[] = [];

async function makeBrand(name: string): Promise<string> {
  const brand = await prisma.brand.create({ data: { brandName: name, referralCode: `PD-${randomToken(6)}` } });
  brandIds.push(brand.id);
  return brand.id;
}

async function makeProduct(prefix: string): Promise<string> {
  const cat = await prisma.catalogProduct.create({
    data: {
      canonicalSku: `RUO-${prefix}${randomToken(4).toUpperCase()}-10MG`,
      compound: prefix,
      name: `Drift Test ${prefix} 10mg`,
      wholesaleStarter: 1000,
      wholesalePro: 900,
      wholesaleVolume: 800,
      suggestedRetail: 5000,
      isPublished: true,
    },
  });
  productIds.push(cat.id);
  return cat.id;
}

describe.skipIf(!RUN)('plan/price drift detection (Task 8a, DB integration)', () => {
  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.catalogProduct.deleteMany({ where: { id: { in: productIds } } });
    await prisma.subscriptionState.deleteMany({ where: { brandId: { in: brandIds } } });
    await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.planPrice.deleteMany({ where: { id: { in: planPriceIds } } });
    await prisma.$disconnect();
  });

  describe('scanDrift — plan_price_mismatch', () => {
    it('a subscription_state row whose stripePriceId has no plan_price match produces a finding', async () => {
      const brandId = await makeBrand(`Drift Unknown Price Co ${randomToken(4)}`);
      const unknownPriceId = `price_drifttest_unknown_${randomToken(6)}`;
      await prisma.subscriptionState.create({
        data: { brandId, plan: 'pro', status: 'active', stripePriceId: unknownPriceId, stripeSubscriptionId: `sub_${randomToken(8)}` },
      });

      const findings = await scanDrift(prisma);
      const finding = findings.find((f) => f.kind === 'plan_price_mismatch' && f.brand_id === brandId);
      expect(finding).toBeTruthy();
      expect(finding!.order_id).toBeUndefined();
      expect(finding!.detail).toContain(unknownPriceId);
    });

    it('a row whose plan_price match has a DIFFERENT plan than the stored plan produces a finding — the stuck-on-old-tier case', async () => {
      const brandId = await makeBrand(`Drift Stuck Tier Co ${randomToken(4)}`);
      // A price that plan_price says is "volume"...
      const rotatedPriceId = `price_drifttest_rotated_${randomToken(6)}`;
      const priceRow = await prisma.planPrice.create({
        data: { plan: 'volume', priceCents: 9900, stripePriceId: rotatedPriceId, active: false, archivedAt: new Date() },
      });
      planPriceIds.push(priceRow.id);
      // ...but the brand's SubscriptionState is still stuck on "pro" — exactly
      // what upsertSubscriptionState's update path leaves behind when a price
      // is rotated for an existing brand from the Stripe Dashboard.
      await prisma.subscriptionState.create({
        data: { brandId, plan: 'pro', status: 'active', stripePriceId: rotatedPriceId, stripeSubscriptionId: `sub_${randomToken(8)}` },
      });

      const findings = await scanDrift(prisma);
      const finding = findings.find((f) => f.kind === 'plan_price_mismatch' && f.brand_id === brandId);
      expect(finding).toBeTruthy();
      expect(finding!.detail).toContain('pro');
      expect(finding!.detail).toContain('volume');
      expect(finding!.order_id).toBeUndefined();
    });

    it('a correctly-matched row produces no finding', async () => {
      const brandId = await makeBrand(`Drift Correct Co ${randomToken(4)}`);
      const priceId = `price_drifttest_correct_${randomToken(6)}`;
      const priceRow = await prisma.planPrice.create({
        data: { plan: 'pro', priceCents: 4900, stripePriceId: priceId, active: false, archivedAt: new Date() },
      });
      planPriceIds.push(priceRow.id);
      await prisma.subscriptionState.create({
        data: { brandId, plan: 'pro', status: 'active', stripePriceId: priceId, stripeSubscriptionId: `sub_${randomToken(8)}` },
      });

      const findings = await scanDrift(prisma);
      expect(findings.find((f) => f.kind === 'plan_price_mismatch' && f.brand_id === brandId)).toBeUndefined();
    });

    it('a subscription_state row with a null stripePriceId is skipped (nothing to compare)', async () => {
      const brandId = await makeBrand(`Drift Null Price Co ${randomToken(4)}`);
      await prisma.subscriptionState.create({
        data: { brandId, plan: 'starter', status: 'active', stripePriceId: null, stripeSubscriptionId: null },
      });

      const findings = await scanDrift(prisma);
      expect(findings.find((f) => f.kind === 'plan_price_mismatch' && f.brand_id === brandId)).toBeUndefined();
    });
  });

  it('the webhook now persists stripePriceId on the subscription_state row', async () => {
    const brandId = await makeBrand(`Drift Webhook Persist Co ${randomToken(4)}`);
    const priceId = `price_drifttest_webhook_${randomToken(6)}`;
    const priceRow = await prisma.planPrice.create({
      data: { plan: 'volume', priceCents: 14900, stripePriceId: priceId, active: false, archivedAt: new Date() },
    });
    planPriceIds.push(priceRow.id);

    const event: NormalizedEvent = {
      kind: 'subscription.activated',
      externalId: `evt_${randomToken(8)}`,
      subscriptionId: `sub_${randomToken(8)}`,
      brandId,
      priceId,
      price: 14900,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86_400,
      cancelAtPeriodEnd: false,
    };
    await dispatchStripeEvent(prisma, event, '127.0.0.1');

    const state = await prisma.subscriptionState.findUnique({ where: { brandId } });
    expect(state).not.toBeNull();
    expect(state!.stripePriceId).toBe(priceId);
    expect(state!.plan).toBe('volume');

    // scanDrift agrees: a correctly-persisted, correctly-matched row is not drift.
    const findings = await scanDrift(prisma);
    expect(findings.find((f) => f.kind === 'plan_price_mismatch' && f.brand_id === brandId)).toBeUndefined();
  });

  describe('scanDrift — existing order-shaped findings still work after the type widening', () => {
    it('shipped_not_captured still reports order_id and brand_name, with no brand_id', async () => {
      const brandId = await makeBrand(`Drift Shipped Co ${randomToken(4)}`);
      const productId = await makeProduct('SH');
      const order = await prisma.order.create({
        data: {
          brandId,
          source: 'manual',
          status: 'shipped',
          blocker: 'none',
          recipientName: 'Drift Case',
          address1: '1 Main',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          wholesaleTotalCents: 3_000,
          shippingTotalCents: 1_200,
          walletChargeCents: 4_200,
          shippedAt: new Date(),
          items: { create: [{ productId, qty: 1, unitWholesaleCents: 3_000 }] },
        },
      });
      orderIds.push(order.id);

      const findings = await scanDrift(prisma);
      const finding = findings.find((f) => f.kind === 'shipped_not_captured' && f.order_id === order.id);
      expect(finding).toBeTruthy();
      expect(finding!.brand_name).toContain('Drift Shipped Co');
      expect(finding!.brand_id).toBeUndefined();
    });

    it('stale_export still reports order_id and brand_name, with no brand_id', async () => {
      const brandId = await makeBrand(`Drift Stale Export Co ${randomToken(4)}`);
      const productId = await makeProduct('SE');
      const order = await prisma.order.create({
        data: {
          brandId,
          source: 'manual',
          status: 'ready_for_fulfillment',
          blocker: 'none',
          recipientName: 'Stale Case',
          address1: '1 Main',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          wholesaleTotalCents: 3_000,
          shippingTotalCents: 1_200,
          walletChargeCents: 4_200,
          exportedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
          items: { create: [{ productId, qty: 1, unitWholesaleCents: 3_000 }] },
        },
      });
      orderIds.push(order.id);

      const findings = await scanDrift(prisma);
      const finding = findings.find((f) => f.kind === 'stale_export' && f.order_id === order.id);
      expect(finding).toBeTruthy();
      expect(finding!.brand_name).toContain('Drift Stale Export Co');
      expect(finding!.brand_id).toBeUndefined();
    });
  });
});
