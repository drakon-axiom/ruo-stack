// Test double for the processor-portability seam. Typed ONLY against the
// `PaymentsAdapter` interface — no Stripe SDK import here, ever. That keeps
// `pnpm lint:stripe-guard` (scripts/check-stripe-imports.mjs) satisfied: the
// Stripe SDK may be imported only inside packages/payments, and this file
// lives under apps/api/test, which the guard also scans.
//
// Pairs with the network rail (./stripe-network-rail.ts): this fake is
// discipline (routes call the interface, never Stripe directly), the rail is
// the actual guarantee (a mistaken real StripeAdapter construction still
// can't reach api.stripe.com in a test run).
import type {
  CreateCheckoutInput,
  CreatePriceInput,
  CreateSubscriptionInput,
  DisputeInput,
  NormalizedEvent,
  PaymentsAdapter,
  RefundCreditInput,
  RetrievedPrice,
  SubscriptionCheckoutInput,
  UpdateSubscriptionInput,
} from '@ruostack/shared';

/** Every adapter method name, used to key call records / scripted failures. */
export type PaymentsMethod = keyof PaymentsAdapter;

/** One recorded invocation. `idempotencyKey` mirrors what StripeAdapter would
 *  send Stripe for the same call (see stripe-adapter.ts) so tests can assert
 *  a retry reuses the same key instead of minting a duplicate. Left
 *  undefined for calls that carry none in the real adapter (reads, cancels). */
export interface RecordedCall {
  method: PaymentsMethod;
  args: unknown[];
  idempotencyKey?: string;
}

/** Deterministic, injective digest of a metadata bag — mirrors
 *  stripe-adapter.ts's metadataDigest closely enough for idempotency-key
 *  parity without needing the `node:crypto` import here. */
function metadataDigest(metadata: Record<string, string> | undefined): string {
  if (!metadata) return 'no-meta';
  const sorted = Object.keys(metadata)
    .sort()
    .map((k) => [k, metadata[k]]);
  return JSON.stringify(sorted);
}

/**
 * In-memory fake of the full PaymentsAdapter surface. Records every call
 * (method, args, derived idempotencyKey) and can be programmed to throw on
 * the Nth call of a given method — the shape Task 8 needs to test "the DB
 * row was written, then Stripe failed."
 */
export class FakePaymentsAdapter implements PaymentsAdapter {
  calls: RecordedCall[] = [];

  private counts = new Map<PaymentsMethod, number>();
  private scriptedFailures = new Map<PaymentsMethod, Map<number, Error>>();
  private idCounter = 0;
  private nextWebhookEvents: NormalizedEvent[] = [];

  /** Throw `error` (default: a descriptive Error) on the Nth call (1-based) of `method`. */
  failOnCall(method: PaymentsMethod, n: number, error?: Error): void {
    let byCall = this.scriptedFailures.get(method);
    if (!byCall) {
      byCall = new Map();
      this.scriptedFailures.set(method, byCall);
    }
    byCall.set(n, error ?? new Error(`FakePaymentsAdapter: scripted failure on ${method} call #${n}`));
  }

  /** Convenience: throw on the very next call of `method`. */
  failNextCall(method: PaymentsMethod, error?: Error): void {
    const already = this.counts.get(method) ?? 0;
    this.failOnCall(method, already + 1, error);
  }

  /** All recorded calls for one method, in order. */
  callsFor(method: PaymentsMethod): RecordedCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** Queue the NormalizedEvent(s) `verifyAndParseWebhook` returns, in order (FIFO). */
  enqueueWebhookEvent(event: NormalizedEvent): void {
    this.nextWebhookEvents.push(event);
  }

  private fakeId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_fake_${this.idCounter}`;
  }

  /** Records the call (incrementing its per-method count) and throws if a
   *  scripted failure was set for this call number — after recording, so
   *  `calls` reflects that the attempt happened even when it "fails". */
  private record(method: PaymentsMethod, args: unknown[], idempotencyKey?: string): void {
    const count = (this.counts.get(method) ?? 0) + 1;
    this.counts.set(method, count);
    this.calls.push({ method, args, idempotencyKey });
    const err = this.scriptedFailures.get(method)?.get(count);
    if (err) throw err;
  }

  async createCustomer(input: { brandId: string; email?: string; name?: string }): Promise<{ customerId: string }> {
    this.record('createCustomer', [input], `cus:${input.brandId}`);
    return { customerId: this.fakeId('cus') };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<{ subscriptionId: string; status: string }> {
    this.record('createSubscription', [input], `sub:${input.customerId}:${input.priceId}`);
    return { subscriptionId: this.fakeId('sub'), status: 'active' };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    this.record('cancelSubscription', [subscriptionId]);
  }

  async updateSubscription(
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ): Promise<{ subscriptionId: string; status: string }> {
    const idempotencyKey = `sub-upd:${subscriptionId}:${input.priceId ?? 'meta'}:${input.prorationBehavior ?? 'none'}:${metadataDigest(input.metadata)}`;
    this.record('updateSubscription', [subscriptionId, input], idempotencyKey);
    return { subscriptionId, status: 'active' };
  }

  async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string; sessionId: string }> {
    this.record('createSubscriptionCheckout', [input]);
    const sessionId = this.fakeId('cs');
    return { url: `https://fake.test/checkout/${sessionId}`, sessionId };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string; sessionId: string }> {
    this.record('createCheckout', [input]);
    const sessionId = this.fakeId('cs');
    return { url: `https://fake.test/checkout/${sessionId}`, sessionId };
  }

  async createBillingPortalSession(customerId: string): Promise<{ url: string }> {
    this.record('createBillingPortalSession', [customerId]);
    return { url: `https://fake.test/portal/${this.fakeId('bps')}` };
  }

  verifyAndParseWebhook(rawBody: Buffer, signature: string): NormalizedEvent {
    this.record('verifyAndParseWebhook', [rawBody, signature]);
    const queued = this.nextWebhookEvents.shift();
    if (queued) return queued;
    return { kind: 'unknown', externalId: this.fakeId('evt'), rawType: 'fake.unscripted' };
  }

  async issueRefundCredit(input: RefundCreditInput): Promise<void> {
    const idempotencyKey = input.chargeId ? `refund:${input.chargeId}:${input.amount}` : undefined;
    this.record('issueRefundCredit', [input], idempotencyKey);
  }

  async handleDispute(input: DisputeInput): Promise<void> {
    this.record('handleDispute', [input]);
  }

  async createPrice(input: CreatePriceInput): Promise<{ priceId: string }> {
    this.record('createPrice', [input], `price:${input.priceVersionId}`);
    return { priceId: this.fakeId('price') };
  }

  async archivePrice(priceId: string): Promise<void> {
    this.record('archivePrice', [priceId], `archive:${priceId}`);
  }

  async retrievePrice(priceId: string): Promise<RetrievedPrice> {
    this.record('retrievePrice', [priceId]);
    return { productId: this.fakeId('prod'), unitAmountCents: 0, currency: 'usd', interval: 'month', active: true };
  }
}
