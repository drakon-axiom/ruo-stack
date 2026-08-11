import { describe, expect, it } from 'vitest';
import { LAPSE_GRACE_DAYS, effectivePlan, isLapsed } from '../../src/services/subscription.ts';

/**
 * Entitlement must survive a payment processor going quiet.
 *
 * Found in the wild: a Pro subscription cancelled at period end kept full Pro
 * for 23 days. Stripe said `canceled`, our row said `active`, and nothing ever
 * reconciled the two because the `customer.subscription.deleted` event never
 * arrived. `effectivePlan` trusted `status` alone, and `current_period_end` was
 * written and displayed but never once compared to the clock.
 *
 * The rule is deliberately LOCAL — no gateway is consulted — so it holds for
 * Stripe, for any processor added later, and for a manual bank transfer an
 * admin recorded by hand. Every payment path does the same one thing: move the
 * paid-through date forward.
 */
const day = 86_400_000;
const now = new Date('2026-08-04T12:00:00Z');
const at = (offsetDays: number) => new Date(now.getTime() + offsetDays * day);

const sub = (over: Partial<{ plan: 'starter' | 'pro' | 'volume'; status: string; currentPeriodEnd: Date | null }> = {}) =>
  ({ plan: 'pro', status: 'active', currentPeriodEnd: at(30), ...over }) as Parameters<typeof effectivePlan>[0];

describe('isLapsed', () => {
  it('is false while the paid-through date is in the future', () => {
    expect(isLapsed({ currentPeriodEnd: at(1) }, now)).toBe(false);
  });

  it('is false just after expiry — inside the grace margin', () => {
    // A renewal webhook running late must not downgrade a paying customer.
    expect(isLapsed({ currentPeriodEnd: at(-1) }, now)).toBe(false);
    expect(isLapsed({ currentPeriodEnd: at(-LAPSE_GRACE_DAYS + 0.01) }, now)).toBe(false);
  });

  it('is true once the grace margin is exhausted', () => {
    expect(isLapsed({ currentPeriodEnd: at(-LAPSE_GRACE_DAYS - 0.01) }, now)).toBe(true);
    expect(isLapsed({ currentPeriodEnd: at(-30) }, now)).toBe(true);
  });

  it('treats a null paid-through date as no expiry, not as expired', () => {
    // That's a comped / manually granted membership with no end date. Reading
    // null as "expired" would silently revoke every one of them.
    expect(isLapsed({ currentPeriodEnd: null }, now)).toBe(false);
  });
});

describe('effectivePlan', () => {
  it('grants the paid tier while active and paid up', () => {
    expect(effectivePlan(sub(), now)).toBe('pro');
  });

  it('keeps the paid tier during dunning, so a transient failure does not break checkout', () => {
    expect(effectivePlan(sub({ status: 'past_due' }), now)).toBe('pro');
  });

  it('DROPS to starter when paid-through lapsed, even though status still says active', () => {
    // The exact production shape: Stripe cancelled the subscription at period
    // end, the deleted event never reached us, the row still reads active.
    expect(effectivePlan(sub({ status: 'active', currentPeriodEnd: at(-23) }), now)).toBe('starter');
  });

  it('drops to starter for a lapsed past_due subscription too', () => {
    expect(effectivePlan(sub({ status: 'past_due', currentPeriodEnd: at(-30) }), now)).toBe('starter');
  });

  it('does NOT drop inside the grace margin', () => {
    expect(effectivePlan(sub({ currentPeriodEnd: at(-1) }), now)).toBe('pro');
  });

  it('honours an open-ended manual grant with no paid-through date', () => {
    expect(effectivePlan(sub({ currentPeriodEnd: null }), now)).toBe('pro');
  });

  it('is starter for suspended, cancelled and none regardless of date', () => {
    for (const status of ['suspended', 'cancelled', 'none']) {
      expect(effectivePlan(sub({ status, currentPeriodEnd: at(365) }), now)).toBe('starter');
    }
  });

  it('is starter with no subscription row at all', () => {
    expect(effectivePlan(null, now)).toBe('starter');
  });

  it('defaults `now` to the current time rather than requiring every caller to pass one', () => {
    // 13 call sites rely on this default; a wrong default silently regrants Pro.
    expect(effectivePlan({ plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() - 400 * day) } as never)).toBe('starter');
    expect(effectivePlan({ plan: 'pro', status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * day) } as never)).toBe('pro');
  });
});
