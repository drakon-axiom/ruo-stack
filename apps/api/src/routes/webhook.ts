import type { FastifyInstance } from 'fastify';
import { Prisma, type PlanTier, type PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, type NormalizedEvent } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { appendEntry } from '../services/wallet.ts';
import { upsertSubscriptionState } from '../services/subscription.ts';

/**
 * Map a Stripe price id to a plan tier via an indexed lookup on
 * `plan_price.stripe_price_id` — across ALL rows, regardless of `active`.
 * `plan_price` is append-only and the column is `@unique`, so it is a
 * permanent price-id → tier index: a brand still subscribed on last
 * quarter's (now archived) price must still resolve to its tier forever.
 *
 * `undefined` used to be an expected outcome (an id that matched neither
 * configured env var). Now that every price this system ever created is in
 * the table, `undefined` means a Stripe price exists that this system never
 * created — a real anomaly, logged at error level for follow-up.
 */
async function planForPrice(db: PrismaClient, priceId?: string): Promise<PlanTier | undefined> {
  if (!priceId) return undefined;
  const row = await db.planPrice.findUnique({ where: { stripePriceId: priceId }, select: { plan: true } });
  if (!row) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhook] Unrecognized Stripe price id "${priceId}": no plan_price row (active or archived) matches it. ` +
        'This price was never created by this system — the subscription tier cannot be resolved.',
    );
    return undefined;
  }
  return row.plan;
}

/**
 * Stripe webhook receiver. Own encapsulated plugin scope so the raw-body parser
 * applies ONLY here. Behavior:
 *   1. Signature-verify via the PaymentsAdapter (throws → 400).
 *   2. Persist WebhookEvent idempotently; if a prior delivery already PROCESSED
 *      it, no-op. Otherwise dispatch (ledger/subscription ops are themselves
 *      idempotent), then mark processed.
 *
 * Membership and wallet ledgers never commingle (architecture §4.1): the
 * dispatch routes strictly by event kind.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, payments } = getClients();

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/api/payments/webhook', async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') return reply.code(400).send({ error: 'missing_signature' });

    let event: NormalizedEvent;
    try {
      event = payments.verifyAndParseWebhook(req.body as Buffer, signature);
    } catch {
      return reply.code(400).send({ error: 'invalid_signature' });
    }

    // Persist idempotently. If we've already fully processed this event, stop.
    try {
      await prisma.webhookEvent.create({
        data: {
          source: 'stripe',
          externalId: event.externalId,
          type: event.kind,
          payload: event as unknown as Prisma.InputJsonValue,
          status: 'received',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await prisma.webhookEvent.findUnique({
          where: { source_externalId: { source: 'stripe', externalId: event.externalId } },
        });
        if (existing?.status === 'processed') {
          return reply.code(200).send({ received: true, idempotent: true });
        }
        // Previously received/failed but not processed — fall through and retry.
      } else {
        throw err;
      }
    }

    // Dispatch. Ledger/subscription writes are idempotent, so a retry is safe.
    try {
      await dispatch(prisma, event, req.ip);
    } catch (err) {
      await prisma.webhookEvent.updateMany({
        where: { source: 'stripe', externalId: event.externalId },
        data: { status: 'failed', attempts: { increment: 1 } },
      });
      req.log.error({ err, kind: event.kind }, 'webhook dispatch failed');
      // 500 → Stripe retries.
      return reply.code(500).send({ error: 'dispatch_failed' });
    }

    await prisma.webhookEvent.updateMany({
      where: { source: 'stripe', externalId: event.externalId },
      data: { status: 'processed', processedAt: new Date(), attempts: { increment: 1 } },
    });
    return reply.code(200).send({ received: true });
  });
}

/** Resolve the brand for an event via injected metadata, falling back to the
 * Stripe customer id mapped onto Brand.stripe_customer_id. */
async function resolveBrandId(
  db: PrismaClient,
  event: Extract<NormalizedEvent, { customerId?: string; brandId?: string }>,
): Promise<string | null> {
  if (event.brandId) return event.brandId;
  if (event.customerId) {
    // stripe_customer_id is unique — a direct, indexed lookup (no seq scan, no
    // ambiguity about which brand an event belongs to).
    const brand = await db.brand.findUnique({ where: { stripeCustomerId: event.customerId }, select: { id: true } });
    return brand?.id ?? null;
  }
  return null;
}

export async function dispatchStripeEvent(db: PrismaClient, event: NormalizedEvent, ip: string): Promise<void> {
  return dispatch(db, event, ip);
}

async function dispatch(db: PrismaClient, event: NormalizedEvent, ip: string): Promise<void> {
  switch (event.kind) {
    case 'wallet.topup_succeeded': {
      const brandId = await resolveBrandId(db, event);
      if (!brandId) return; // unattributable — leave for manual reconciliation
      const { duplicate } = await appendEntry(db, {
        brandId,
        type: 'deposit',
        amount: event.amount ?? 0,
        externalId: event.externalId,
        reason: 'Stripe wallet top-up',
      });
      if (!duplicate) {
        await writeAudit(db, {
          actorType: 'system',
          actorId: null,
          action: AUDIT_ACTIONS.walletDeposit,
          targetType: 'brand',
          targetId: brandId,
          after: { amount_cents: event.amount, external_id: event.externalId },
          ip,
        });
      }
      return;
    }
    case 'subscription.activated':
    case 'subscription.past_due':
    case 'subscription.suspended':
    case 'subscription.cancelled': {
      const brandId = await resolveBrandId(db, event);
      if (!brandId) return;
      const status =
        event.kind === 'subscription.activated'
          ? 'active'
          : event.kind === 'subscription.past_due'
            ? 'past_due'
            : event.kind === 'subscription.suspended'
              ? 'suspended'
              : 'cancelled';
      await upsertSubscriptionState(db, {
        brandId,
        status,
        plan: await planForPrice(db, event.priceId),
        stripeSubscriptionId: event.subscriptionId,
        // Persisted regardless of whether the price resolved to a tier —
        // Task 3 added this column for exactly this (SubscriptionState.stripePriceId,
        // schema.prisma:636) and reconciliation's plan/price drift check
        // (services/reconciliation.ts) depends on it being populated even when
        // `plan` above came back undefined.
        stripePriceId: event.priceId ?? null,
        ...(event.kind === 'subscription.activated'
          ? {
              price: event.price,
              currentPeriodEnd: event.currentPeriodEnd ? new Date(event.currentPeriodEnd * 1000) : null,
              cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
            }
          : {}),
      });
      await writeAudit(db, {
        actorType: 'system',
        actorId: null,
        action: AUDIT_ACTIONS.subscriptionStatusChanged,
        targetType: 'brand',
        targetId: brandId,
        after: { status, subscription_id: event.subscriptionId },
        ip,
      });
      return;
    }
    // wallet.topup_failed, dispute.opened, refund.processed, unknown:
    // no ledger mutation in Phase 1 (refund-to-wallet is admin-initiated, §4.3).
    default:
      return;
  }
}
