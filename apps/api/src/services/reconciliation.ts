import type { PrismaClient, WebhookEvent } from '@ruostack/db';
import { AUDIT_ACTIONS, type NormalizedEvent } from '@ruostack/shared';
import { writeAudit } from '../audit.ts';
import { dispatchStripeEvent } from '../routes/webhook.ts';
import { importWooOrder, type WooOrder } from './store-intake.ts';

/**
 * Sync/reconcile worker (§8/§10): heal missed/failed webhooks and flag drift
 * between RUOStack and the external systems. Idempotent dispatch makes re-runs
 * safe; nothing here mutates money beyond the (idempotent) webhook handlers.
 */
const MAX_WEBHOOK_ATTEMPTS = 5;
const RETRY_GRACE_MS = 120_000; // don't race the live handler / external retry
const STALE_EXPORT_MS = 24 * 60 * 60 * 1000;

// ── Heal: re-dispatch stuck webhook events ─────────────────────────────────────
async function redispatch(prisma: PrismaClient, ev: WebhookEvent): Promise<void> {
  if (ev.source === 'stripe') {
    await dispatchStripeEvent(prisma, ev.payload as unknown as NormalizedEvent, 'reconcile');
    return;
  }
  if (ev.source === 'woocommerce') {
    const connectionId = ev.externalId.split(':')[0]!;
    const conn = await prisma.brandStoreConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new Error('store connection no longer exists');
    await importWooOrder(prisma, conn, ev.payload as unknown as WooOrder); // idempotent
    return;
  }
  throw new Error(`unknown webhook source ${ev.source}`);
}

export interface RetryResult {
  examined: number;
  healed: number;
  failed: number;
  deadLetter: number;
}

export async function retryStuckWebhooks(prisma: PrismaClient): Promise<RetryResult> {
  const stuck = await prisma.webhookEvent.findMany({
    where: { status: { in: ['received', 'failed'] }, attempts: { lt: MAX_WEBHOOK_ATTEMPTS }, createdAt: { lt: new Date(Date.now() - RETRY_GRACE_MS) } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  let healed = 0;
  let failed = 0;
  for (const ev of stuck) {
    try {
      await redispatch(prisma, ev);
      await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: 'processed', processedAt: new Date(), attempts: { increment: 1 } } });
      healed++;
    } catch {
      await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: 'failed', attempts: { increment: 1 } } });
      failed++;
    }
  }
  const deadLetter = await prisma.webhookEvent.count({ where: { status: 'failed', attempts: { gte: MAX_WEBHOOK_ATTEMPTS } } });
  return { examined: stuck.length, healed, failed, deadLetter };
}

// ── Flag: drift between order state and money/fulfillment ──────────────────────
/**
 * `order_id`/`brand_id` are both optional because not every finding has an
 * order to point at: `shipped_not_captured` and `stale_export` are
 * order-shaped, but `plan_price_mismatch` (Task 8a) is subscription-shaped —
 * a brand's stored plan disagreeing with its Stripe price has no order in
 * play. Widened rather than jamming a brand id into `order_id`, which would
 * make every consumer's `order_id` lookups (the admin Exceptions screen, the
 * ledger heal-by-order-id flow) ambiguous about what kind of id they hold.
 */
export interface DriftFinding {
  kind: 'shipped_not_captured' | 'stale_export' | 'plan_price_mismatch';
  order_id?: string;
  brand_id?: string;
  brand_name: string;
  detail: string;
  at: Date | null;
}

export async function scanDrift(prisma: PrismaClient): Promise<DriftFinding[]> {
  const findings: DriftFinding[] = [];

  // Shipped/delivered but the wallet was never captured (and not a known
  // awaiting-funds collections case).
  const shipped = await prisma.order.findMany({
    where: { status: { in: ['shipped', 'delivered'] }, blocker: { not: 'awaiting_funds' } },
    orderBy: { shippedAt: 'desc' },
    take: 500,
    select: { id: true, walletChargeCents: true, shippedAt: true, brand: { select: { brandName: true } } },
  });
  if (shipped.length > 0) {
    const captureIds = shipped.map((o) => `order:${o.id}:capture`);
    const captures = await prisma.walletLedger.findMany({ where: { type: 'capture', externalId: { in: captureIds } }, select: { externalId: true } });
    const captured = new Set(captures.map((c) => c.externalId));
    for (const o of shipped) {
      if (!captured.has(`order:${o.id}:capture`)) {
        findings.push({ kind: 'shipped_not_captured', order_id: o.id, brand_name: o.brand.brandName, detail: `$${(o.walletChargeCents / 100).toFixed(2)} uncaptured`, at: o.shippedAt });
      }
    }
  }

  // Exported to ShipStation long ago but still sitting in the ready queue.
  const stale = await prisma.order.findMany({
    where: { status: 'ready_for_fulfillment', exportedAt: { lt: new Date(Date.now() - STALE_EXPORT_MS) } },
    orderBy: { exportedAt: 'asc' },
    take: 200,
    select: { id: true, exportedAt: true, brand: { select: { brandName: true } } },
  });
  for (const o of stale) {
    findings.push({ kind: 'stale_export', order_id: o.id, brand_name: o.brand.brandName, detail: 'exported but not shipped > 24h', at: o.exportedAt });
  }

  // Plan/price drift (Task 8a): a SubscriptionState whose stored `plan`
  // doesn't agree with what its Stripe price actually maps to in
  // `plan_price`. Two ways in:
  //   - the price isn't in `plan_price` at all — a price this system never
  //     created (e.g. hand-made in the Stripe Dashboard).
  //   - the price IS in `plan_price`, but for a DIFFERENT plan than the one
  //     stored — the stuck-on-old-tier case: a brand's price was rotated in
  //     the Stripe Dashboard and `upsertSubscriptionState`'s update path
  //     left the stored tier untouched (by design — see subscription.ts).
  //     This is the one that actually costs money: `effectivePlan()` keeps
  //     billing wholesale at the STORED tier while Stripe collects for the
  //     new one.
  // Rows with no `stripePriceId` are skipped — nothing to compare against
  // (starter has no Stripe price at all; plan_price.stripePriceId is null
  // forever for starter too). Also scoped to status active/past_due, the
  // only statuses `effectivePlan()` (subscription.ts) ever honours — it
  // forces 'starter' for anything else (cancelled/expired/suspended/none),
  // so a mismatch on one of those rows has zero financial exposure (the
  // harm chain this exists to catch can't fire) and is permanently
  // non-actionable (nobody corrects a dead subscription's historical
  // Stripe price). Matches the scoping every other subscriber-scoped query
  // in the codebase uses (plan-preflight.ts, plan-price.ts's
  // migration_required guard, reporting.ts, admin-overview.ts,
  // brand-overview.ts).
  const subs = await prisma.subscriptionState.findMany({
    where: { stripePriceId: { not: null }, status: { in: ['active', 'past_due'] } },
    select: { brandId: true, plan: true, stripePriceId: true, updatedAt: true, brand: { select: { brandName: true } } },
  });
  if (subs.length > 0) {
    const priceIds = [...new Set(subs.map((s) => s.stripePriceId!))];
    const prices = await prisma.planPrice.findMany({
      where: { stripePriceId: { in: priceIds } },
      select: { stripePriceId: true, plan: true },
    });
    const planForPriceId = new Map(prices.map((p) => [p.stripePriceId!, p.plan]));
    for (const s of subs) {
      const matchedPlan = planForPriceId.get(s.stripePriceId!);
      if (matchedPlan === undefined) {
        findings.push({
          kind: 'plan_price_mismatch',
          brand_id: s.brandId,
          brand_name: s.brand.brandName,
          detail: `Stripe price ${s.stripePriceId} has no plan_price row (stored tier: ${s.plan})`,
          at: s.updatedAt,
        });
      } else if (matchedPlan !== s.plan) {
        findings.push({
          kind: 'plan_price_mismatch',
          brand_id: s.brandId,
          brand_name: s.brand.brandName,
          detail: `stored tier "${s.plan}" disagrees with "${matchedPlan}", the tier its Stripe price (${s.stripePriceId}) actually maps to`,
          at: s.updatedAt,
        });
      }
    }
  }

  return findings;
}

export interface ReconciliationReport {
  retry: RetryResult;
  drift: DriftFinding[];
  ranAt: Date;
}

export async function runReconciliation(prisma: PrismaClient): Promise<ReconciliationReport> {
  const retry = await retryStuckWebhooks(prisma);
  const drift = await scanDrift(prisma);
  await writeAudit(prisma, {
    actorType: 'system',
    actorId: null,
    action: AUDIT_ACTIONS.reconciliationRun,
    after: { healed: retry.healed, failed: retry.failed, dead_letter: retry.deadLetter, drift: drift.length },
    ip: null,
  });
  return { retry, drift, ranAt: new Date() };
}

/** Periodic worker (runs once on start, then every interval). Unref'd. */
export function startReconciliationWorker(prisma: PrismaClient, intervalMs: number, log?: (msg: string) => void): () => void {
  const tick = () => {
    runReconciliation(prisma)
      .then((r) => log?.(`reconcile: healed ${r.retry.healed}, failed ${r.retry.failed}, dead-letter ${r.retry.deadLetter}, drift ${r.drift.length}`))
      .catch((err) => log?.(`reconcile failed: ${err instanceof Error ? err.message : err}`));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
