import type {
  CreateCheckoutInput,
  CreateSubscriptionInput,
  DisputeInput,
  NormalizedEvent,
  PaymentsAdapter,
  RefundCreditInput,
  SubscriptionCheckoutInput,
} from '@ruostack/shared';

/**
 * The processor-portability seam, proven. A high-risk acquirer is the most
 * likely fallback (payments-framework §1.2) when Stripe rug-pulls the vertical.
 * Every method throws — its EXISTENCE proves core depends only on the interface.
 * Do not fake behavior; Phase 1+ implements a real one behind the same contract.
 */
export class HighRiskAcquirerAdapter implements PaymentsAdapter {
  private fail(method: string): never {
    throw new Error(`NotImplemented: HighRiskAcquirer.${method}`);
  }

  createCustomer(_input: { brandId: string; email?: string; name?: string }): Promise<{ customerId: string }> {
    return this.fail('createCustomer');
  }
  createSubscription(_input: CreateSubscriptionInput): Promise<{ subscriptionId: string; status: string }> {
    return this.fail('createSubscription');
  }
  createSubscriptionCheckout(_input: SubscriptionCheckoutInput): Promise<{ url: string; sessionId: string }> {
    return this.fail('createSubscriptionCheckout');
  }
  cancelSubscription(_subscriptionId: string): Promise<void> {
    return this.fail('cancelSubscription');
  }
  updateSubscription(
    _subscriptionId: string,
    _input: Partial<CreateSubscriptionInput>,
  ): Promise<{ subscriptionId: string; status: string }> {
    return this.fail('updateSubscription');
  }
  createCheckout(_input: CreateCheckoutInput): Promise<{ url: string; sessionId: string }> {
    return this.fail('createCheckout');
  }
  createBillingPortalSession(_customerId: string): Promise<{ url: string }> {
    return this.fail('createBillingPortalSession');
  }
  verifyAndParseWebhook(_rawBody: Buffer, _signature: string): NormalizedEvent {
    return this.fail('verifyAndParseWebhook');
  }
  issueRefundCredit(_input: RefundCreditInput): Promise<void> {
    return this.fail('issueRefundCredit');
  }
  handleDispute(_input: DisputeInput): Promise<void> {
    return this.fail('handleDispute');
  }
}
