/**
 * The processor-portability seam (payments-framework §3, architecture §5.1).
 * Core/business code calls ONLY this interface — never a processor SDK directly.
 * A forced migration off Stripe becomes a new adapter, not a rewrite.
 */

/** Money is always integer cents across RUOStack. */
export type Cents = number;

/**
 * Processor events normalized into RUOStack's internal vocabulary so core never
 * imports Stripe types. `externalId` is the processor event id (idempotency key).
 */
export type NormalizedEvent =
  | { kind: 'wallet.topup_succeeded'; externalId: string; brandId?: string; amount?: Cents; currency?: string; customerId?: string }
  | { kind: 'wallet.topup_failed'; externalId: string; brandId?: string; amount?: Cents; reason?: string; customerId?: string }
  | { kind: 'subscription.activated'; externalId: string; subscriptionId: string; brandId?: string; customerId?: string; priceId?: string; price?: Cents; currentPeriodEnd?: number; cancelAtPeriodEnd?: boolean }
  | { kind: 'subscription.past_due'; externalId: string; subscriptionId: string; brandId?: string; customerId?: string; priceId?: string }
  | { kind: 'subscription.suspended'; externalId: string; subscriptionId: string; brandId?: string; customerId?: string; priceId?: string }
  | { kind: 'subscription.cancelled'; externalId: string; subscriptionId: string; brandId?: string; customerId?: string; priceId?: string }
  | { kind: 'dispute.opened'; externalId: string; amount?: Cents; chargeId?: string }
  | { kind: 'refund.processed'; externalId: string; amount?: Cents; chargeId?: string }
  | { kind: 'unknown'; externalId: string; rawType: string };

export interface CreateSubscriptionInput {
  customerId: string;
  priceId: string;
  metadata?: Record<string, string>;
}

export interface SubscriptionCheckoutInput {
  customerId: string;
  priceId: string;
  brandId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutInput {
  /** Wallet top-up amount, integer cents. */
  amount: Cents;
  currency?: string;
  customerId?: string;
  brandId: string;
  successUrl: string;
  cancelUrl: string;
  /** Statement descriptor / line item must read as software/logistics, never peptides. */
  description?: string;
}

export interface RefundCreditInput {
  chargeId?: string;
  amount: Cents;
  brandId: string;
  reason?: string;
}

export interface DisputeInput {
  disputeId: string;
  chargeId?: string;
}

export interface PaymentsAdapter {
  /** Create/ensure a processor customer for a brand (returns the customer id). */
  createCustomer(input: { brandId: string; email?: string; name?: string }): Promise<{ customerId: string }>;
  createSubscription(input: CreateSubscriptionInput): Promise<{ subscriptionId: string; status: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  updateSubscription(
    subscriptionId: string,
    input: Partial<CreateSubscriptionInput>,
  ): Promise<{ subscriptionId: string; status: string }>;
  /** Pro membership signup via hosted Checkout (subscription mode; collects card). */
  createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<{ url: string; sessionId: string }>;
  /** Wallet top-up. Returns a live (test-mode) hosted checkout URL. */
  createCheckout(input: CreateCheckoutInput): Promise<{ url: string; sessionId: string }>;
  /** Phase 1 brand self-service portal; define the seam now. */
  createBillingPortalSession(customerId: string): Promise<{ url: string }>;
  /** Verify the processor signature and map the event → NormalizedEvent. Throws on bad signature. */
  verifyAndParseWebhook(rawBody: Buffer, signature: string): NormalizedEvent;
  issueRefundCredit(input: RefundCreditInput): Promise<void>;
  handleDispute(input: DisputeInput): Promise<void>;
}

/** Statement-descriptor / product names — software/logistics, never peptides (payments §1.3). */
export const STATEMENT_DESCRIPTORS = {
  membership: 'RUOStack Membership',
  walletTopup: 'RUOStack Fulfillment Credit',
} as const;
