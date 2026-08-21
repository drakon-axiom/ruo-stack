import type { FastifyInstance } from 'fastify';
import {
  AUDIT_ACTIONS,
  PLAN_KEYS,
  STATEMENT_DESCRIPTORS,
  SubscribeSchema,
  WalletTopupSchema,
  type PaidPlanKey,
  type PlanKey,
} from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { loadConfig } from '../config.ts';
import { writeAudit } from '../audit.ts';
import { requireBrand, requireBrandSurface } from '../middleware/guards.ts';
import { BadRequest, Conflict, NotFound } from '../errors.ts';
import { getWalletSummary } from '../services/wallet.ts';
import { effectivePlan, isLapsed } from '../services/subscription.ts';
import { getPlanRegistry, storeConnectionsUpsellMessage, type ResolvedPlan } from '../services/plan-registry.ts';

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
  price_version_id: string | null;
  paid: boolean;
  features: string[];
}[] {
  return PLAN_KEYS.filter((key) => !registry[key].paid || registry[key].stripePriceId !== null).map((key) => ({
    key: registry[key].key,
    name: registry[key].name,
    price_cents: registry[key].priceCents,
    price_version_id: registry[key].priceVersionId,
    paid: registry[key].paid,
    features: registry[key].features,
  }));
}

// Return URLs adapt to whichever origin the brand app was loaded from. Takes
// a plain `origin` string (not the full FastifyRequest) so it can be
// exercised directly by a unit-level test — see subscribeBrandToPaidPlan below.
function returnUrls(origin: string | undefined, path: string) {
  const o = origin || 'http://localhost:3903';
  return { successUrl: `${o}${path}?status=success`, cancelUrl: `${o}${path}?status=cancelled` };
}

// Create the Stripe customer for a brand on first need; persist the id.
// Module-level (not a closure over one getClients() call at route-registration
// time) so it always reads whatever client setClientsForTest() has installed
// at call time — required for subscribeBrandToPaidPlan to be unit-testable.
async function ensureCustomer(brandId: string): Promise<string> {
  const { prisma, payments, supabaseAdmin } = getClients();
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

/**
 * Core of `POST /api/brand/billing/subscribe` — the checkout quote-token
 * check. Extracted to a standalone, exported function (rather than an inline
 * route closure) because brand routes carry Supabase-minted JWTs that no
 * test can forge: this is how the "stale token is rejected before any
 * Stripe call" and "current token resolves the DB price id" behaviors get
 * exercised, by calling this function directly with setClientsForTest(...)
 * swapping in a FakePaymentsAdapter — not through app.inject.
 *
 * The quote-token check: `priceVersionId` must name a `plan_price` row that
 * (a) exists, (b) belongs to the requested `plan`, and (c) is still
 * `active`. All three are read off ONE row in ONE query — not "does this id
 * match whatever the registry currently considers active", which would be a
 * second, separately-timed read of the same fact and a needless TOCTOU gap.
 * Because `plan_price_one_active_per_plan` guarantees at most one active row
 * per tier, "this specific row is active" and "this is THE active row for
 * this tier" are the same statement — so this check cannot produce a false
 * rejection: a row that is still active is, definitionally, still current.
 *
 * Runs before any Stripe call (ensureCustomer can itself call Stripe to
 * create a customer) — a stale token is refused with zero calls to the
 * payments adapter, not just a refused checkout session.
 */
export async function subscribeBrandToPaidPlan(
  ctx: { origin: string | undefined; ip: string },
  input: { brandId: string; userId: string; plan: PaidPlanKey; priceVersionId: string },
): Promise<{ url: string }> {
  const { prisma, payments } = getClients();

  const priceRow = await prisma.planPrice.findUnique({ where: { id: input.priceVersionId } });
  if (!priceRow || priceRow.plan !== input.plan || !priceRow.active) {
    // "Pricing has changed" covers all three failure shapes (unknown id,
    // wrong plan, archived row) — from the brand's point of view they are
    // the same fact: the quote they're holding is no longer the live price.
    throw Conflict('price_changed', 'Pricing has changed — please review.');
  }
  // Same row the plan card's displayed price_cents came from — the fix this
  // whole plan exists to deliver: what's advertised and what Checkout
  // charges can no longer diverge, because both are read from this one row.
  const priceId = priceRow.stripePriceId;
  if (!priceId) {
    throw BadRequest('plan_price_unconfigured', `No active Stripe price configured for plan "${input.plan}"`);
  }

  const customerId = await ensureCustomer(input.brandId);
  const { successUrl, cancelUrl } = returnUrls(ctx.origin, '/app/account');
  const { url, sessionId } = await payments.createSubscriptionCheckout({
    customerId,
    priceId,
    brandId: input.brandId,
    successUrl,
    cancelUrl,
  });
  await writeAudit(prisma, {
    actorType: 'brand',
    actorId: input.userId,
    action: AUDIT_ACTIONS.subscriptionCheckoutStarted,
    targetType: 'brand',
    targetId: input.brandId,
    after: { plan: input.plan, session_id: sessionId, price_version_id: input.priceVersionId, price_cents: priceRow.priceCents },
    ip: ctx.ip,
  });
  return { url };
}

export async function brandBillingRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, payments } = getClients();

  // ── Subscribe to a PAID plan (Pro/Volume) via hosted Checkout ──────────────
  // Starter is the free default — selected by cancelling a paid plan in the portal.
  app.post('/api/brand/billing/subscribe', { preHandler: requireBrandSurface('billing') }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { plan, price_version_id } = SubscribeSchema.parse(req.body);
    return subscribeBrandToPaidPlan(
      { origin: req.headers.origin as string | undefined, ip: req.ip },
      { brandId, userId, plan, priceVersionId: price_version_id },
    );
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
      // Upsell copy, derived from the registry (not a hardcoded tier list) so
      // it can't drift from the plan cards below when an admin renames a
      // tier — same message brand-store.ts's 403s use.
      upsell: {
        store_connections: storeConnectionsUpsellMessage(registry),
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
    const { successUrl, cancelUrl } = returnUrls(req.headers.origin as string | undefined, '/app/wallet');
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
