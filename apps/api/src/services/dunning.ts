import type { PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, PLANS, type EmailAdapter, type PlanKey } from '@ruostack/shared';
import { writeAudit } from '../audit.js';
import { upsertSubscriptionState } from './subscription.js';

/**
 * Membership dunning (§9 billing): a failed payment puts the subscription
 * past_due (Pro features retained during a grace window — see effectivePlan). The
 * brand gets one payment-failed notice; if it's still past_due after the grace
 * window, features are suspended. Recovery (invoice.paid → active) clears the
 * dunning state in upsertSubscriptionState.
 */

// Minimal structural type so this service doesn't depend on the Supabase SDK.
interface SupabaseAuthAdmin {
  auth: { admin: { getUserById(id: string): Promise<{ data: { user: { email?: string | null } | null } }> } };
}

async function ownerEmail(prisma: PrismaClient, supabase: SupabaseAuthAdmin, brandId: string): Promise<string | null> {
  const owner = await prisma.brandMember.findFirst({ where: { brandId, role: 'owner' }, select: { userId: true } });
  if (!owner) return null;
  return (await supabase.auth.admin.getUserById(owner.userId)).data.user?.email ?? null;
}

export interface DunningResult {
  examined: number;
  notified: number;
  suspended: number;
}

export async function sweepDunning(prisma: PrismaClient, email: EmailAdapter, supabase: SupabaseAuthAdmin, graceDays: number): Promise<DunningResult> {
  const graceMs = graceDays * 86_400_000;
  const now = Date.now();
  const pastDue = await prisma.subscriptionState.findMany({
    where: { status: 'past_due' },
    select: { brandId: true, plan: true, pastDueSince: true, dunningNotifiedAt: true },
  });

  let notified = 0;
  let suspended = 0;
  for (const s of pastDue) {
    const to = await ownerEmail(prisma, supabase, s.brandId).catch(() => null);
    const planName = PLANS[s.plan as PlanKey].name;

    // 1. One payment-failed notice on first sight.
    if (!s.dunningNotifiedAt) {
      if (to) {
        await email
          .send({ to, subject: `Payment failed — update your ${planName} plan`, text: `We couldn't process your ${planName} membership payment. Update your card in the billing portal to keep your plan features — you have ${graceDays} days before they're paused.` })
          .catch(() => {});
      }
      await prisma.subscriptionState.update({ where: { brandId: s.brandId }, data: { dunningNotifiedAt: new Date() } });
      notified++;
    }

    // 2. Grace exhausted → suspend Pro features.
    if (s.pastDueSince && now - s.pastDueSince.getTime() >= graceMs) {
      await upsertSubscriptionState(prisma, { brandId: s.brandId, status: 'suspended', plan: s.plan });
      await writeAudit(prisma, {
        actorType: 'system',
        actorId: null,
        action: AUDIT_ACTIONS.subscriptionStatusChanged,
        targetType: 'brand',
        targetId: s.brandId,
        after: { status: 'suspended', reason: 'dunning_grace_expired' },
        ip: null,
      });
      if (to) {
        await email
          .send({ to, subject: `Your ${planName} plan is paused`, text: `After a failed payment and a ${graceDays}-day grace period, your ${planName} features are paused. Update your card in the billing portal to restore them.` })
          .catch(() => {});
      }
      suspended++;
    }
  }
  return { examined: pastDue.length, notified, suspended };
}

/** Periodic dunning sweep (runs on start, then every interval). Unref'd. */
export function startDunningWorker(prisma: PrismaClient, email: EmailAdapter, supabase: SupabaseAuthAdmin, graceDays: number, intervalMs: number, log?: (m: string) => void): () => void {
  const tick = () => {
    sweepDunning(prisma, email, supabase, graceDays)
      .then((r) => { if (r.notified || r.suspended) log?.(`dunning: notified ${r.notified}, suspended ${r.suspended}`); })
      .catch((err) => log?.(`dunning failed: ${err instanceof Error ? err.message : err}`));
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}
