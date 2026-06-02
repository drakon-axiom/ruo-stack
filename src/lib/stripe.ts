import Stripe from 'stripe';

/** Server-side Stripe client (B2B: Pro subscription + seller wallet top-ups). */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
  typescript: true,
});
