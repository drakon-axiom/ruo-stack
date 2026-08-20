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
  function stubSubscriptions(a: StripeAdapter): { id: string; params: Stripe.SubscriptionUpdateParams }[] {
    const captured: { id: string; params: Stripe.SubscriptionUpdateParams }[] = [];
    // Stub the private Stripe client's subscription methods (no network).
    (a as unknown as { stripe: Stripe }).stripe.subscriptions = {
      retrieve: async () => ({ items: { data: [{ id: 'si_existing' }] } }),
      update: async (id: string, params: Stripe.SubscriptionUpdateParams) => {
        captured.push({ id, params });
        return { id: 'sub_1', status: 'active' };
      },
    } as unknown as Stripe['subscriptions'];
    return captured;
  }

  it('replaces the existing item (passes its id) instead of adding a second one', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured = stubSubscriptions(a);

    await a.updateSubscription('sub_1', { priceId: 'price_volume' });

    expect(captured).toHaveLength(1);
    // The existing item id must be present so Stripe swaps the price in place.
    expect(captured[0]!.params.items).toEqual([{ id: 'si_existing', price: 'price_volume' }]);
  });

  it('defaults proration_behavior to "none" — never invents a charge/credit on the next invoice', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured = stubSubscriptions(a);

    await a.updateSubscription('sub_1', { priceId: 'price_volume' });

    expect(captured[0]!.params.proration_behavior).toBe('none');
  });

  it('opts into prorations only when explicitly requested', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured = stubSubscriptions(a);

    await a.updateSubscription('sub_1', { priceId: 'price_volume', prorationBehavior: 'create_prorations' });

    expect(captured[0]!.params.proration_behavior).toBe('create_prorations');
  });

  it('NEVER sets billing_cycle_anchor — combined with proration_behavior:"none" that is a straight double bill', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured = stubSubscriptions(a);

    await a.updateSubscription('sub_1', { priceId: 'price_volume' });

    expect(captured[0]!.params).not.toHaveProperty('billing_cycle_anchor');
  });

  it('throws instead of ADDing an item when the subscription has zero items', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    (a as unknown as { stripe: Stripe }).stripe.subscriptions = {
      retrieve: async () => ({ items: { data: [] } }),
      update: async () => {
        throw new Error('update should never be reached');
      },
    } as unknown as Stripe['subscriptions'];

    await expect(a.updateSubscription('sub_empty', { priceId: 'price_volume' })).rejects.toThrow(
      /sub_empty/,
    );
  });

  it('throws instead of guessing which item to swap when the subscription has more than one item', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    (a as unknown as { stripe: Stripe }).stripe.subscriptions = {
      retrieve: async () => ({ items: { data: [{ id: 'si_1' }, { id: 'si_2' }] } }),
      update: async () => {
        throw new Error('update should never be reached');
      },
    } as unknown as Stripe['subscriptions'];

    await expect(a.updateSubscription('sub_multi', { priceId: 'price_volume' })).rejects.toThrow(
      /sub_multi/,
    );
  });

  it('folds prorationBehavior into the idempotency key so a dry-run and a commit pass do not collide', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured: { id: string; params: Stripe.SubscriptionUpdateParams; opts: Stripe.RequestOptions }[] = [];
    (a as unknown as { stripe: Stripe }).stripe.subscriptions = {
      retrieve: async () => ({ items: { data: [{ id: 'si_existing' }] } }),
      update: async (id: string, params: Stripe.SubscriptionUpdateParams, opts: Stripe.RequestOptions) => {
        captured.push({ id, params, opts });
        return { id: 'sub_1', status: 'active' };
      },
    } as unknown as Stripe['subscriptions'];

    await a.updateSubscription('sub_1', { priceId: 'price_volume' });
    await a.updateSubscription('sub_1', { priceId: 'price_volume', prorationBehavior: 'create_prorations' });

    expect(captured[0]!.opts.idempotencyKey).not.toEqual(captured[1]!.opts.idempotencyKey);
  });

  it('does not collide on adversarial metadata that would render identically under a naive key=value join', async () => {
    // { a: '1,b=2' } and { a: '1', b: '2' } both render as the literal string
    // "a=1,b=2" under an unescaped `${key}=${value}` join — a genuinely
    // different metadata object must still produce a different key.
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured: { id: string; params: Stripe.SubscriptionUpdateParams; opts: Stripe.RequestOptions }[] = [];
    (a as unknown as { stripe: Stripe }).stripe.subscriptions = {
      retrieve: async () => ({ items: { data: [{ id: 'si_existing' }] } }),
      update: async (id: string, params: Stripe.SubscriptionUpdateParams, opts: Stripe.RequestOptions) => {
        captured.push({ id, params, opts });
        return { id: 'sub_1', status: 'active' };
      },
    } as unknown as Stripe['subscriptions'];

    await a.updateSubscription('sub_1', {
      priceId: 'price_volume',
      prorationBehavior: 'none',
      metadata: { a: '1,b=2' },
    });
    await a.updateSubscription('sub_1', {
      priceId: 'price_volume',
      prorationBehavior: 'none',
      metadata: { a: '1', b: '2' },
    });

    expect(captured[0]!.opts.idempotencyKey).not.toEqual(captured[1]!.opts.idempotencyKey);
  });
});

describe('StripeAdapter.createPrice', () => {
  function stubPrices(a: StripeAdapter): { params: Stripe.PriceCreateParams; opts: Stripe.RequestOptions }[] {
    const captured: { params: Stripe.PriceCreateParams; opts: Stripe.RequestOptions }[] = [];
    (a as unknown as { stripe: Stripe }).stripe.prices = {
      create: async (params: Stripe.PriceCreateParams, opts: Stripe.RequestOptions) => {
        captured.push({ params, opts });
        return { id: 'price_new' };
      },
    } as unknown as Stripe['prices'];
    return captured;
  }

  const input = {
    productId: 'prod_1',
    amountCents: 4900,
    currency: 'usd',
    interval: 'month' as const,
    planKey: 'pro',
    priceVersionId: 'pv_abc123',
  };

  it('sets lookup_key, transfer_lookup_key, metadata, an integer unit_amount, and pins currency/interval/tax_behavior', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured = stubPrices(a);

    const result = await a.createPrice(input);

    expect(result).toEqual({ priceId: 'price_new' });
    const { params } = captured[0]!;
    expect(params.lookup_key).toBeTruthy();
    expect(params.transfer_lookup_key).toBe(true);
    expect(params.metadata).toMatchObject({ plan_key: 'pro', price_version_id: 'pv_abc123' });
    expect(Number.isInteger(params.unit_amount)).toBe(true);
    expect(params.unit_amount).toBe(4900);
    expect(params.currency).toBe('usd');
    // Pinned exactly — not just "some interval": interval_count is part of the
    // pin too, so e.g. a stray interval_count:3 (quarterly) would fail this.
    expect(params.recurring).toEqual({ interval: 'month', interval_count: 1 });
    // Pinned exactly — 'inclusive'/'exclusive' would silently pass a looser
    // "is defined" check but is not the value every price generation must share.
    expect(params.tax_behavior).toBe('unspecified');
    expect(params.product).toBe('prod_1');
  });

  it('produces an identical idempotency key for two identical calls', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured = stubPrices(a);

    await a.createPrice(input);
    await a.createPrice(input);

    expect(captured).toHaveLength(2);
    expect(captured[0]!.opts.idempotencyKey).toBeTruthy();
    expect(captured[0]!.opts.idempotencyKey).toEqual(captured[1]!.opts.idempotencyKey);
  });

  it('produces a DIFFERENT idempotency key for a different priceVersionId — otherwise a second plan silently receives the first plan\'s Price', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured = stubPrices(a);

    await a.createPrice(input);
    await a.createPrice({ ...input, priceVersionId: 'pv_other456' });

    expect(captured[0]!.opts.idempotencyKey).not.toEqual(captured[1]!.opts.idempotencyKey);
  });
});

describe('StripeAdapter.archivePrice', () => {
  it('deactivates a price via prices.update', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    const captured: { id: string; params: Stripe.PriceUpdateParams }[] = [];
    (a as unknown as { stripe: Stripe }).stripe.prices = {
      update: async (id: string, params: Stripe.PriceUpdateParams) => {
        captured.push({ id, params });
        return { id, active: false };
      },
    } as unknown as Stripe['prices'];

    await a.archivePrice('price_old');

    expect(captured).toEqual([{ id: 'price_old', params: { active: false } }]);
  });

  it('tolerates an already-inactive price (no throw)', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    (a as unknown as { stripe: Stripe }).stripe.prices = {
      update: async (id: string) => ({ id, active: false }),
    } as unknown as Stripe['prices'];

    await expect(a.archivePrice('price_already_inactive')).resolves.not.toThrow();
  });
});

describe('StripeAdapter.retrievePrice', () => {
  it('normalizes a Stripe Price into productId/unitAmountCents/currency/interval/active', async () => {
    const a = new StripeAdapter({ secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET });
    (a as unknown as { stripe: Stripe }).stripe.prices = {
      retrieve: async () => ({
        id: 'price_1',
        product: 'prod_9',
        unit_amount: 14900,
        currency: 'usd',
        recurring: { interval: 'month' },
        active: true,
      }),
    } as unknown as Stripe['prices'];

    const result = await a.retrievePrice('price_1');

    expect(result).toEqual({
      productId: 'prod_9',
      unitAmountCents: 14900,
      currency: 'usd',
      interval: 'month',
      active: true,
    });
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

  it('throws NotImplemented for the price primitives (portability proof for Task 2)', () => {
    const a = new HighRiskAcquirerAdapter();
    expect(() => a.createPrice({} as never)).toThrow(/NotImplemented/);
    expect(() => a.archivePrice('price_1')).toThrow(/NotImplemented/);
    expect(() => a.retrievePrice('price_1')).toThrow(/NotImplemented/);
  });
});
