export { StripeAdapter } from './stripe-adapter.ts';
export type { StripeAdapterConfig } from './stripe-adapter.ts';
export { HighRiskAcquirerAdapter } from './high-risk-acquirer-adapter.ts';
// Re-export the contract so consumers import the seam from one place.
export type { PaymentsAdapter, NormalizedEvent } from '@ruostack/shared';
