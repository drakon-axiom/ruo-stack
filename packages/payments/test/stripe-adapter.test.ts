import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { StripeAdapter } from '../src/stripe-adapter.js';
import { HighRiskAcquirerAdapter } from '../src/high-risk-acquirer-adapter.js';

const WEBHOOK_SECRET = 'whsec_test_secret';
const adapter = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
const stripe = new Stripe('sk_test_dummy');

function signed(payload: object): { raw: Buffer; sig: string } {
  const body = JSON.stringify(payload);
  const sig = stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
  return { raw: Buffer.from(body), sig };
}

describe('StripeAdapter.verifyAndParseWebhook', () => {
  it('rejects a bad signature', () => {
    const { raw } = signed({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
    expect(() => adapter.verifyAndParseWebhook(raw, 't=1,v1=deadbeef')).toThrow();
  });

  it('normalizes a settled (paid) wallet top-up checkout completion', () => {
    const { raw, sig } = signed({
      id: 'evt_topup',
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', metadata: { kind: 'wallet_topup', brand_id: 'brand-123' }, amount_total: 5000, currency: 'usd' } },
    });
    const event = adapter.verifyAndParseWebhook(raw, sig);
    expect(event).toMatchObject({ kind: 'wallet.topup_succeeded', externalId: 'evt_topup', brandId: 'brand-123', amount: 5000 });
  });

  it('does NOT credit an unpaid (async, not-yet-settled) top-up completion', () => {
    const { raw, sig } = signed({
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'unpaid', metadata: { kind: 'wallet_topup', brand_id: 'brand-123' }, amount_total: 5000, currency: 'usd' } },
    });
    // Unpaid → not a top-up-succeeded; the wallet must not be credited until it settles.
    expect(adapter.verifyAndParseWebhook(raw, sig)).toMatchObject({ kind: 'unknown' });
  });

  it('credits a wallet top-up once the async payment succeeds', () => {
    const { raw, sig } = signed({
      id: 'evt_async_ok',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: { payment_status: 'paid', metadata: { kind: 'wallet_topup', brand_id: 'brand-123' }, amount_total: 5000, currency: 'usd' } },
    });
    expect(adapter.verifyAndParseWebhook(raw, sig)).toMatchObject({ kind: 'wallet.topup_succeeded', brandId: 'brand-123', amount: 5000 });
  });

  it('maps an async payment failure to topup_failed', () => {
    const { raw, sig } = signed({
      id: 'evt_async_fail',
      type: 'checkout.session.async_payment_failed',
      data: { object: { payment_status: 'unpaid', metadata: { kind: 'wallet_topup', brand_id: 'brand-123' }, amount_total: 5000 } },
    });
    expect(adapter.verifyAndParseWebhook(raw, sig)).toMatchObject({ kind: 'wallet.topup_failed', brandId: 'brand-123' });
  });

  it('maps a subscription deletion to cancelled', () => {
    const { raw, sig } = signed({
      id: 'evt_sub',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
    });
    expect(adapter.verifyAndParseWebhook(raw, sig)).toMatchObject({ kind: 'subscription.cancelled', subscriptionId: 'sub_1' });
  });

  it('falls back to unknown for unhandled event types', () => {
    const { raw, sig } = signed({ id: 'evt_x', type: 'invoice.created', data: { object: {} } });
    expect(adapter.verifyAndParseWebhook(raw, sig)).toMatchObject({ kind: 'unknown', rawType: 'invoice.created' });
  });

  it('maps a wallet-topup PI failure to topup_failed', () => {
    const { raw, sig } = signed({
      id: 'evt_pi_fail',
      type: 'payment_intent.payment_failed',
      data: { object: { metadata: { kind: 'wallet_topup', brand_id: 'brand-9' }, amount: 5000 } },
    });
    expect(adapter.verifyAndParseWebhook(raw, sig)).toMatchObject({ kind: 'wallet.topup_failed', brandId: 'brand-9' });
  });

  it('does NOT label a non-topup PI failure (e.g. a subscription invoice) as a topup failure', () => {
    const { raw, sig } = signed({
      id: 'evt_pi_sub',
      type: 'payment_intent.payment_failed',
      data: { object: { metadata: { kind: 'membership' }, amount: 4900 } },
    });
    expect(adapter.verifyAndParseWebhook(raw, sig)).toMatchObject({ kind: 'unknown' });
  });
});

describe('StripeAdapter.updateSubscription', () => {
  it('replaces the existing item (passes its id) instead of adding a second one', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured: { id: string; params: Stripe.SubscriptionUpdateParams }[] = [];
    // Stub the private Stripe client's subscription methods (no network).
    (a as unknown as { stripe: Stripe }).stripe.subscriptions = {
      retrieve: async () => ({ items: { data: [{ id: 'si_existing' }] } }),
      update: async (id: string, params: Stripe.SubscriptionUpdateParams) => {
        captured.push({ id, params });
        return { id: 'sub_1', status: 'active' };
      },
    } as unknown as Stripe['subscriptions'];

    await a.updateSubscription('sub_1', { priceId: 'price_volume' });

    expect(captured).toHaveLength(1);
    // The existing item id must be present so Stripe swaps the price in place.
    expect(captured[0]!.params.items).toEqual([{ id: 'si_existing', price: 'price_volume' }]);
  });
});

describe('HighRiskAcquirerAdapter (seam proof)', () => {
  it('throws NotImplemented for every method', () => {
    const a = new HighRiskAcquirerAdapter();
    expect(() => a.verifyAndParseWebhook(Buffer.from(''), 'x')).toThrow(/NotImplemented/);
    expect(() => a.createCheckout({} as never)).toThrow(/NotImplemented/);
    expect(() => a.cancelSubscription('s')).toThrow(/NotImplemented/);
    expect(() => a.issueRefundCredit({} as never)).toThrow(/NotImplemented/);
  });
});
