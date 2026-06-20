import type { FastifyInstance } from 'fastify';
import { getClients } from '../clients.js';
import { requireAdmin } from '../middleware/guards.js';
import { runReconciliation, scanDrift } from '../services/reconciliation.js';

const MAX_WEBHOOK_ATTEMPTS = 5;

/**
 * Reconciliation / Exceptions surface (§8/§10): dead-letter webhooks + live drift
 * findings, and an on-demand reconciliation run. The worker also runs on a
 * schedule (RECONCILE_INTERVAL_SECONDS). Role-gated on 'exceptions'.
 */
export async function adminReconciliationRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  app.get('/api/admin/reconciliation', { preHandler: requireAdmin('exceptions', 'view') }, async () => {
    const [deadLetter, retryable, drift] = await Promise.all([
      prisma.webhookEvent.findMany({
        where: { status: 'failed', attempts: { gte: MAX_WEBHOOK_ATTEMPTS } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, source: true, type: true, attempts: true, externalId: true, createdAt: true },
      }),
      prisma.webhookEvent.count({ where: { status: { in: ['received', 'failed'] }, attempts: { lt: MAX_WEBHOOK_ATTEMPTS } } }),
      scanDrift(prisma),
    ]);
    return {
      dead_letter: deadLetter.map((e) => ({ id: e.id, source: e.source, type: e.type, attempts: e.attempts, external_id: e.externalId, created_at: e.createdAt })),
      retryable_count: retryable,
      drift,
    };
  });

  app.post('/api/admin/reconciliation/run', { preHandler: requireAdmin('exceptions', 'write') }, async () => {
    return runReconciliation(prisma);
  });
}
