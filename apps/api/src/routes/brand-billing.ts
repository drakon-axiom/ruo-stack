import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AUDIT_ACTIONS,
  PLANS,
  PLAN_LIST,
  STATEMENT_DESCRIPTORS,
  SubscribeSchema,
  WalletTopupSchema,
} from '@ruostack/shared';
import { getClients } from '../clients.js';
import { loadConfig } from '../config.js';
import { writeAudit } from '../audit.js';
import { requireBrand } from '../middleware/guards.js';
import { BadRequest, NotFound } from '../errors.js';
import { getBalance } from '../services/wallet.js';
import { effectivePlan } from '../services/subscription.js';

/**
 * Brand-facing money layer (Phase 1): Pro membership + prepaid wallet. Core never
 * touches Stripe directly — everything goes through the PaymentsAdapter. Wallet
 * funds are non-refundable (closed-loop). No ledger mutation happens here; the
 * wallet is only credited by the webhook receiver on confirmed payment.
 */
export async function brandBillingRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, payments, supabaseAdmin } = getClients();
  const cfg = loadConfig();

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
  app.post('/api/brand/billing/subscribe', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { plan } = SubscribeSchema.parse(req.body);
    const priceEnv = PLANS[plan].stripePriceEnv!; // paid plans always have one
    const priceId = cfg[priceEnv];
    if (!priceId) throw BadRequest('plan_price_unconfigured', `${priceEnv} is not set`);

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
  app.post('/api/brand/billing/portal-session', { preHandler: requireBrand }, async (req) => {
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
    const current = effectivePlan(sub); // effective tier (starter unless active)
    return {
      status: sub?.status ?? 'none',
      current_plan: current, // what they're entitled to right now
      billed_plan: sub?.plan ?? 'starter', // what Stripe is billing (may differ if past_due)
      current_period_end: sub?.currentPeriodEnd ?? null,
      capabilities: PLANS[current].capabilities,
      // The catalogue the plan-picker renders.
      plans: PLAN_LIST.map((p) => ({
        key: p.key,
        name: p.name,
        price_cents: p.priceCents,
        paid: p.paid,
        features: p.features,
      })),
    };
  });

  // ── Wallet top-up (hosted Checkout, payment mode) ──────────────────────────
  app.post('/api/brand/wallet/topup', { preHandler: requireBrand }, async (req) => {
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
    const [balance, entries] = await Promise.all([
      getBalance(prisma, brandId),
      prisma.walletLedger.findMany({ where: { brandId }, orderBy: { seq: 'desc' }, take: 50 }),
    ]);
    return {
      balance_cents: balance,
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
