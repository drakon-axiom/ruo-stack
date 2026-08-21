import { describe, expect, it } from 'vitest';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';

// Smoke-tests the fake itself: it's the double every later task (4, 8) builds
// its Stripe-adjacent tests on, so its own recording/scripted-failure
// behaviour needs to be trustworthy before anything else depends on it.
describe('FakePaymentsAdapter', () => {
  it('records method, args, and a derived idempotencyKey per call', async () => {
    const fake = new FakePaymentsAdapter();
    await fake.createCustomer({ brandId: 'brand_1', email: 'a@b.com' });
    expect(fake.calls).toEqual([
      { method: 'createCustomer', args: [{ brandId: 'brand_1', email: 'a@b.com' }], idempotencyKey: 'cus:brand_1' },
    ]);
  });

  it('createPrice derives the idempotency key the same way StripeAdapter does; archivePrice sends none', async () => {
    const fake = new FakePaymentsAdapter();
    const { priceId } = await fake.createPrice({
      productId: 'prod_1',
      amountCents: 1999,
      currency: 'usd',
      interval: 'month',
      planKey: 'pro',
      priceVersionId: 'pv_1',
    });
    await fake.archivePrice(priceId);
    expect(fake.callsFor('createPrice')[0]?.idempotencyKey).toBe('price:pv_1');
    // StripeAdapter.archivePrice calls prices.update(priceId, { active: false })
    // with no idempotencyKey option — setting a Price inactive twice is
    // naturally idempotent, so it never needed one. The fake must not
    // fabricate a key the real adapter doesn't send.
    expect(fake.callsFor('archivePrice')[0]?.idempotencyKey).toBeUndefined();
  });

  it('failOnCall throws on exactly the Nth call of a method and lets other calls through', async () => {
    const fake = new FakePaymentsAdapter();
    fake.failOnCall('createSubscription', 2, new Error('stripe down'));

    const first = await fake.createSubscription({ customerId: 'cus_1', priceId: 'price_1' });
    expect(first.subscriptionId).toMatch(/^sub_fake_/);

    await expect(fake.createSubscription({ customerId: 'cus_1', priceId: 'price_1' })).rejects.toThrow('stripe down');

    // The failed attempt is still recorded — the DB row was already written
    // before this call in the real flow, so the test needs to see the attempt.
    expect(fake.callsFor('createSubscription')).toHaveLength(2);

    const third = await fake.createSubscription({ customerId: 'cus_1', priceId: 'price_1' });
    expect(third.subscriptionId).toMatch(/^sub_fake_/);
  });

  it('failNextCall schedules a failure on whichever call comes next, regardless of prior calls', async () => {
    const fake = new FakePaymentsAdapter();
    await fake.archivePrice('price_1');
    fake.failNextCall('archivePrice');
    await expect(fake.archivePrice('price_2')).rejects.toThrow(/scripted failure on archivePrice call #2/);
  });

  it('verifyAndParseWebhook returns queued events in FIFO order, falling back to unknown', () => {
    const fake = new FakePaymentsAdapter();
    fake.enqueueWebhookEvent({ kind: 'subscription.activated', externalId: 'evt_1', subscriptionId: 'sub_1' });
    const first = fake.verifyAndParseWebhook(Buffer.from(''), 'sig');
    expect(first).toEqual({ kind: 'subscription.activated', externalId: 'evt_1', subscriptionId: 'sub_1' });

    const second = fake.verifyAndParseWebhook(Buffer.from(''), 'sig');
    expect(second.kind).toBe('unknown');
  });
});
