export { StripeAdapter } from './stripe-adapter.js';
export type { StripeAdapterConfig } from './stripe-adapter.js';
export { HighRiskAcquirerAdapter } from './high-risk-acquirer-adapter.js';
// Re-export the contract so consumers import the seam from one place.
export type { PaymentsAdapter, NormalizedEvent } from '@ruostack/shared';
