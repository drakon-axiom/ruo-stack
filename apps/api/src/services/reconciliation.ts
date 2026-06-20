import type { PrismaClient, WebhookEvent } from '@ruostack/db';
import { AUDIT_ACTIONS, type NormalizedEvent } from '@ruostack/shared';
import { writeAudit } from '../audit.js';
import { dispatchStripeEvent } from '../routes/webhook.js';
import { importWooOrder, type WooOrder } from './store-intake.js';

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
export interface DriftFinding {
  kind: 'shipped_not_captured' | 'stale_export';
  order_id: string;
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
