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

  it('normalizes a wallet top-up checkout completion', () => {
    const { raw, sig } = signed({
      id: 'evt_topup',
      type: 'checkout.session.completed',
      data: { object: { metadata: { kind: 'wallet_topup', brand_id: 'brand-123' }, amount_total: 5000, currency: 'usd' } },
    });
    const event = adapter.verifyAndParseWebhook(raw, sig);
    expect(event).toMatchObject({ kind: 'wallet.topup_succeeded', externalId: 'evt_topup', brandId: 'brand-123', amount: 5000 });
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
