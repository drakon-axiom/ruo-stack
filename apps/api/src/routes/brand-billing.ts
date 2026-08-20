import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AUDIT_ACTIONS,
  PLAN_KEYS,
  STATEMENT_DESCRIPTORS,
  SubscribeSchema,
  WalletTopupSchema,
  type PlanKey,
} from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { loadConfig } from '../config.ts';
import { writeAudit } from '../audit.ts';
import { requireBrand, requireBrandSurface } from '../middleware/guards.ts';
import { BadRequest, NotFound } from '../errors.ts';
import { getWalletSummary } from '../services/wallet.ts';
import { effectivePlan, isLapsed } from '../services/subscription.ts';
import { getPlanRegistry, type ResolvedPlan } from '../services/plan-registry.ts';

/**
 * Brand-facing money layer (Phase 1): Pro membership + prepaid wallet. Core never
 * touches Stripe directly — everything goes through the PaymentsAdapter. Wallet
 * funds are non-refundable (closed-loop). No ledger mutation happens here; the
 * wallet is only credited by the webhook receiver on confirmed payment.
 */

/**
 * The plan-picker catalogue: every tier a brand could actually subscribe to
 * right now. Drops a paid tier whose active `plan_price` row has no
 * `stripe_price_id` — unbuyable (Checkout would refuse it via
 * `plan_price_unconfigured`, right above in this file) — instead of shipping
 * it as a live, clickable "$0.00 — Choose X" card: `Account.tsx` prints
 * `price_cents` unconditionally and wires the whole card to `onClick`, so an
 * un-configured paid plan would otherwise advertise a real product for free
 * and then 400 on click. An absent card can't be mispriced or clicked — the
 * invariant becomes "every card shown is buyable at the price shown."
 *
 * Fixed at this presentation boundary, not inside `plan-registry.ts`
 * itself — `getPlanRegistry()` still returns the raw, truthful state (used
 * by orders/store/shipping/dunning, none of which should 5xx over a billing
 * display gap). Unreachable today: the `plan_price_starter_free_ck` CHECK
 * constraint forces a non-starter active row to carry a `stripe_price_id`.
 * Becomes reachable once price rotation (Task 8) can leave a paid tier
 * between an archived price and a not-yet-active new one.
 */
export function buyablePlanCatalog(registry: Record<PlanKey, ResolvedPlan>): {
  key: PlanKey;
  name: string;
  price_cents: number;
  paid: boolean;
  features: string[];
}[] {
  return PLAN_KEYS.filter((key) => !registry[key].paid || registry[key].stripePriceId !== null).map((key) => ({
    key: registry[key].key,
    name: registry[key].name,
    price_cents: registry[key].priceCents,
    paid: registry[key].paid,
    features: registry[key].features,
  }));
}

export async function brandBillingRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, payments, supabaseAdmin } = getClients();

  // Return URLs adapt to whichever origin the brand app was loaded from.
  function returnUrls(req: FastifyRequest, path: string) {
    const origin = (req.headers.origin as string) || 'http://localhost:3903';
    return { successUrl: `${origin}${path}?status=success`, cancelUrl: `${origin}${path}?status=cancelled` };
  }

  // Create the Stripe customer for a brand on first need; persist the id.
  async function ensureCustomer(brandId: string): Promise<string> {
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw NotFound('Brand not found');
    if (brand.stripeCustomerId) return brand.stripeCustomerId;

    // Best-effort email for the Stripe customer (owner of the brand).
    const owner = await prisma.brandMember.findFirst({ where: { brandId, role: 'owner' }, select: { userId: true } });
    let email: string | undefined;
    if (owner) {
      const u = await supabaseAdmin.auth.admin.getUserById(owner.userId);
      email = u.data.user?.email ?? undefined;
    }
    const { customerId } = await payments.createCustomer({ brandId, email, name: brand.brandName });
    await prisma.brand.update({ where: { id: brandId }, data: { stripeCustomerId: customerId } });
    return customerId;
  }

  // ── Subscribe to a PAID plan (Pro/Volume) via hosted Checkout ──────────────
  // Starter is the free default — selected by cancelling a paid plan in the portal.
  app.post('/api/brand/billing/subscribe', { preHandler: requireBrandSurface('billing') }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { plan } = SubscribeSchema.parse(req.body);
    const registry = await getPlanRegistry(prisma);
    // Same row the plan card's displayed price_cents comes from — the fix
    // this whole plan exists to deliver: what's advertised and what Checkout
    // charges can no longer diverge, because both are read from this one row.
    const priceId = registry[plan].stripePriceId;
    if (!priceId) throw BadRequest('plan_price_unconfigured', `No active Stripe price configured for plan "${plan}"`);

    const customerId = await ensureCustomer(brandId);
    const { successUrl, cancelUrl } = returnUrls(req, '/app/account');
    const { url, sessionId } = await payments.createSubscriptionCheckout({
      customerId,
      priceId,
      brandId,
      successUrl,
      cancelUrl,
    });
    await writeAudit(prisma, {
      actorType: 'brand',
      actorId: userId,
      action: AUDIT_ACTIONS.subscriptionCheckoutStarted,
      targetType: 'brand',
      targetId: brandId,
      after: { plan, session_id: sessionId },
      ip: req.ip,
    });
    return { url };
  });

  // ── Stripe Billing Portal (manage/cancel/update payment method) ────────────
  app.post('/api/brand/billing/portal-session', { preHandler: requireBrandSurface('billing') }, async (req) => {
    const { brandId } = req.brand!;
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand?.stripeCustomerId) throw BadRequest('no_customer', 'No billing account yet — subscribe first');
    const { url } = await payments.createBillingPortalSession(brand.stripeCustomerId);
    return { url };
  });

  // ── Subscription state + the plan catalogue for the picker ─────────────────
  app.get('/api/brand/subscription', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const sub = await prisma.subscriptionState.findUnique({ where: { brandId } });
    const current = effectivePlan(sub); // effective tier (paid while active/past_due)
    const registry = await getPlanRegistry(prisma);
    const graceMs = loadConfig().DUNNING_GRACE_DAYS * 86_400_000;
    const graceEndsAt = sub?.pastDueSince ? new Date(sub.pastDueSince.getTime() + graceMs) : null;
    return {
      status: sub?.status ?? 'none',
      current_plan: current, // what they're entitled to right now
      billed_plan: sub?.plan ?? 'starter', // what Stripe is billing (may differ if past_due)
      current_period_end: sub?.currentPeriodEnd ?? null,
      cancel_at_period_end: sub?.cancelAtPeriodEnd ?? false,
      // Dunning surface: a failed payment keeps features during the grace window.
      past_due_since: sub?.pastDueSince ?? null,
      grace_ends_at: graceEndsAt,
      // Paid-through has passed. Surfaced separately from `status` because the
      // stored status is only as fresh as the last event we received — the UI
      // must never render "Renews <date>" for a date that has already gone by.
      lapsed: sub ? isLapsed(sub) : false,
      paid_through_passed: !!sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now(),
      // `cancelled` is deliberate — the brand chose Starter, so don't nag. The
      // rest mean we didn't get paid. ('suspended' only appears on pre-025 rows.)
      payment_action_needed:
        sub?.status === 'past_due' ||
        sub?.status === 'expired' ||
        sub?.status === 'suspended' ||
        (sub ? isLapsed(sub) : false),
      capabilities: {
        store_connections: registry[current].capabilities.storeConnections,
        max_orders_per_month: registry[current].capabilities.maxOrdersPerMonth,
        shipping: registry[current].capabilities.shipping,
        shipping_cutoff: registry[current].capabilities.shippingCutoff,
      },
      // The catalogue the plan-picker renders — same DB rows as everything
      // else on this response, so the advertised price_cents and the price
      // Checkout charges (resolved from the same active plan_price row in
      // POST /api/brand/billing/subscribe) can never disagree. Unbuyable
      // paid tiers are dropped rather than shown at $0 — see buyablePlanCatalog.
      plans: buyablePlanCatalog(registry),
    };
  });

  // ── Wallet top-up (hosted Checkout, payment mode) ──────────────────────────
  app.post('/api/brand/wallet/topup', { preHandler: requireBrandSurface('wallet'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { brandId, userId } = req.brand!;
    const body = WalletTopupSchema.parse(req.body); // enforces non-refundable acknowledgment
    const customerId = await ensureCustomer(brandId);
    const { successUrl, cancelUrl } = returnUrls(req, '/app/wallet');
    const { url, sessionId } = await payments.createCheckout({
      amount: body.amount_cents,
      brandId,
      customerId,
      successUrl,
      cancelUrl,
      description: `${STATEMENT_DESCRIPTORS.walletTopup} — non-refundable prepaid fulfillment credit.`,
    });
    await writeAudit(prisma, {
      actorType: 'brand',
      actorId: userId,
      action: AUDIT_ACTIONS.walletTopupStarted,
      targetType: 'brand',
      targetId: brandId,
      after: { amount_cents: body.amount_cents, session_id: sessionId },
      ip: req.ip,
    });
    return { url };
  });

  // ── Wallet balance + ledger ────────────────────────────────────────────────
  app.get('/api/brand/wallet', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const [summary, entries] = await Promise.all([
      getWalletSummary(prisma, brandId),
      prisma.walletLedger.findMany({ where: { brandId }, orderBy: { seq: 'desc' }, take: 50 }),
    ]);
    return {
      balance_cents: summary.balance,
      held_cents: summary.held,
      available_cents: summary.available,
      entries: entries.map((e) => ({
        id: e.id,
        type: e.type,
        amount_cents: e.amount,
        balance_after_cents: e.balanceAfter,
        reason: e.reason,
        created_at: e.createdAt,
      })),
    };
  });
}
