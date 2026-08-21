import { describe, expect, it } from 'vitest';
import { Forbidden } from '../../src/errors.ts';

/**
 * The mechanism apps/brand-web/src/screens/Shipping.tsx depends on to tell
 * "the plan doesn't allow store connections" (brand-store.ts's five
 * plan-gate 403s) apart from every OTHER 403 in the app — most notably
 * guards.ts's suspended-brand (line 24) and revoked-membership (line 32)
 * checks, whose text must never be rendered as marketing upsell copy.
 *
 * Every 403 shares the same HTTP status (403) and, by default, the same
 * `error` code ('forbidden' — errors.ts) — so the client can only
 * discriminate by a distinguishing code, never by status alone. A
 * regression here (Forbidden() losing its optional second parameter, or a
 * plan-gate call site reverting to the single-argument form) would make
 * Shipping.tsx's client-side switch silently start rendering an account-
 * suspension or membership-revocation message as "upgrade your plan" copy
 * again — the exact bug a coordinator review caught and this file guards
 * against.
 */
describe('Forbidden() error codes — the plan-gate 403 must stay distinguishable from every other 403', () => {
  it('defaults to the generic "forbidden" code when no code is given, matching every guards.ts call site', () => {
    // Mirrors guards.ts:24, :32, :46 and :74 — none of them pass a second argument.
    expect(Forbidden('This account is suspended — contact support').code).toBe('forbidden');
    expect(Forbidden('Your access to this brand has been revoked').code).toBe('forbidden');
    expect(Forbidden('Only the brand owner can do that').code).toBe('forbidden');
    expect(Forbidden().code).toBe('forbidden');
  });

  it('carries a caller-supplied code — the shape brand-store.ts\'s five plan-gate sites use', () => {
    const err = Forbidden('Store connections require the Pro or Volume plan', 'store_connections_required');
    expect(err.code).toBe('store_connections_required');
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Store connections require the Pro or Volume plan');
  });

  it('the plan-gate code and the default guards.ts code are never equal', () => {
    const guardsStyle = Forbidden('Your access to this brand has been revoked'); // no code passed
    const planGateStyle = Forbidden('Store connections require the Pro or Volume plan', 'store_connections_required');
    expect(guardsStyle.code).not.toBe(planGateStyle.code);
  });
});
