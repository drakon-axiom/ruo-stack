// ⚠️  THE ONLY FILE IN THE REPO THAT MAY IMPORT THE STRIPE SDK.
// Enforced by scripts/check-stripe-imports.mjs (critical invariant #4).
import Stripe from 'stripe';
import type {
  CreateCheckoutInput,
  CreateSubscriptionInput,
  DisputeInput,
  NormalizedEvent,
  PaymentsAdapter,
  RefundCreditInput,
  SubscriptionCheckoutInput,
} from '@ruostack/shared';
import { STATEMENT_DESCRIPTORS } from '@ruostack/shared';

export interface StripeAdapterConfig {
  secretKey: string;
  webhookSecret: string;
  /** Membership recurring price (Phase 1 flows; held for createSubscription). */
  membershipPriceId?: string;
}

/**
 * Real Stripe implementation of the processor seam. Core/business code never
 * sees a Stripe type — everything crosses the boundary as NormalizedEvent /
 * plain DTOs. Statement descriptors read as software/logistics (payments §1.3).
 */
export class StripeAdapter implements PaymentsAdapter {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly config: StripeAdapterConfig) {
    this.stripe = new Stripe(config.secretKey);
    this.webhookSecret = config.webhookSecret;
  }

  async createCustomer(input: { brandId: string; email?: string; name?: string }): Promise<{ customerId: string }> {
    const c = await this.stripe.customers.create({
      email: input.email,
      name: input.name,
      metadata: { brand_id: input.brandId },
    });
    return { customerId: c.id };
  }

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<{ subscriptionId: string; status: string }> {
    const sub = await this.stripe.subscriptions.create({
      customer: input.customerId,
      items: [{ price: input.priceId }],
      metadata: input.metadata,
    });
    return { subscriptionId: sub.id, status: sub.status };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
  }

  async updateSubscription(
    subscriptionId: string,
    input: Partial<CreateSubscriptionInput>,
  ): Promise<{ subscriptionId: string; status: string }> {
    const sub = await this.stripe.subscriptions.update(subscriptionId, {
      ...(input.priceId ? { items: [{ price: input.priceId }] } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return { subscriptionId: sub.id, status: sub.status };
  }

  /** Pro membership signup via hosted Checkout (subscription mode). */
  async createSubscriptionCheckout(
    input: SubscriptionCheckoutInput,
  ): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      subscription_data: {
        metadata: { brand_id: input.brandId, kind: 'membership' },
      },
      metadata: { brand_id: input.brandId, kind: 'membership' },
    });
    if (!session.url) throw new Error('Stripe did not return a Checkout URL');
    return { url: session.url, sessionId: session.id };
  }

  /** Wallet top-up → live (test-mode) hosted Checkout URL. */
  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string; sessionId: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      ...(input.customerId ? { customer: input.customerId } : {}),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency ?? 'usd',
            unit_amount: input.amount, // integer cents
            product_data: {
              name: STATEMENT_DESCRIPTORS.walletTopup, // software/logistics, never peptides
              description: input.description ?? 'Prepaid fulfillment credit (non-refundable).',
            },
          },
        },
      ],
      payment_intent_data: {
        statement_descriptor_suffix: 'FULFILLMENT',
      },
      metadata: { brand_id: input.brandId, kind: 'wallet_topup' },
    });
    if (!session.url) throw new Error('Stripe did not return a Checkout URL');
    return { url: session.url, sessionId: session.id };
  }

  /** Phase 1 brand self-service portal; the seam is real now. */
  async createBillingPortalSession(customerId: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({ customer: customerId });
    return { url: session.url };
  }

  /** Verify the Stripe signature and map → NormalizedEvent. Throws on bad signature. */
  verifyAndParseWebhook(rawBody: Buffer, signature: string): NormalizedEvent {
    // constructEvent throws Stripe.errors.StripeSignatureVerificationError on a bad sig.
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return mapStripeEvent(event);
  }

  async issueRefundCredit(input: RefundCreditInput): Promise<void> {
    // Closed-loop design: refunds credit the WALLET, never the card. The wallet
    // ledger entry is core/Phase 1. At the processor level, a refund is only
    // issued when an actual card charge must be reversed (e.g. dispute loss).
    if (input.chargeId) {
      await this.stripe.refunds.create({
        charge: input.chargeId,
        amount: input.amount,
        metadata: { brand_id: input.brandId, reason: input.reason ?? '' },
      });
    }
    // TODO(Phase 1): write the refund_credit WalletLedger entry in core.
  }

  async handleDispute(input: DisputeInput): Promise<void> {
    // Phase 0: surface the dispute; ledger/exception wiring is Phase 1.
    await this.stripe.disputes.retrieve(input.disputeId);
    // TODO(Phase 1): route to the Exceptions console + freeze affected wallet holds.
  }
}

/** Stripe event type → RUOStack NormalizedEvent (core never imports Stripe types). */
function mapStripeEvent(event: Stripe.Event): NormalizedEvent {
  const externalId = event.id;
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.kind === 'wallet_topup') {
        return {
          kind: 'wallet.topup_succeeded',
          externalId,
          brandId: s.metadata?.brand_id,
          amount: s.amount_total ?? undefined,
          currency: s.currency ?? undefined,
          customerId: typeof s.customer === 'string' ? s.customer : undefined,
        };
      }
      return { kind: 'unknown', externalId, rawType: event.type };
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent;
      return {
        kind: 'wallet.topup_failed',
        externalId,
        brandId: pi.metadata?.brand_id,
        amount: pi.amount ?? undefined,
        reason: pi.last_payment_error?.message ?? undefined,
        customerId: typeof pi.customer === 'string' ? pi.customer : undefined,
      };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : undefined;
      const brandId = sub.metadata?.brand_id;
      if (sub.status === 'active' || sub.status === 'trialing') {
        // current_period_end sits on the Subscription in older API versions and
        // on the item in newer ones — read defensively across SDK versions.
        const item = sub.items.data[0];
        const currentPeriodEnd =
          (sub as unknown as { current_period_end?: number }).current_period_end ??
          (item as unknown as { current_period_end?: number } | undefined)?.current_period_end;
        return {
          kind: 'subscription.activated',
          externalId,
          subscriptionId: sub.id,
          brandId,
          customerId,
          price: item?.price?.unit_amount ?? undefined,
          currentPeriodEnd,
        };
      }
      if (sub.status === 'past_due' || sub.status === 'unpaid') {
        return { kind: 'subscription.past_due', externalId, subscriptionId: sub.id, brandId, customerId };
      }
      if (sub.status === 'paused') {
        return { kind: 'subscription.suspended', externalId, subscriptionId: sub.id, brandId, customerId };
      }
      return { kind: 'unknown', externalId, rawType: `${event.type}:${sub.status}` };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        kind: 'subscription.cancelled',
        externalId,
        subscriptionId: sub.id,
        brandId: sub.metadata?.brand_id,
        customerId: typeof sub.customer === 'string' ? sub.customer : undefined,
      };
    }
    case 'charge.dispute.created': {
      const d = event.data.object as Stripe.Dispute;
      return {
        kind: 'dispute.opened',
        externalId,
        amount: d.amount ?? undefined,
        chargeId: typeof d.charge === 'string' ? d.charge : undefined,
      };
    }
    case 'charge.refunded': {
      const c = event.data.object as Stripe.Charge;
      return { kind: 'refund.processed', externalId, amount: c.amount_refunded ?? undefined, chargeId: c.id };
    }
    default:
      return { kind: 'unknown', externalId, rawType: event.type };
  }
}
