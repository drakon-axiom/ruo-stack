import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.js';
import { requireAdmin } from '../middleware/guards.js';
import { buildReport } from '../services/reporting.js';

/**
 * Admin Overview — platform health at a glance (architecture §1.3). Aggregates
 * across all brands. Viewable by every admin role.
 */
export async function adminOverviewRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // Reporting dashboard — analytical metrics over a rolling window.
  app.get('/api/admin/reporting', { preHandler: requireAdmin('overview', 'view') }, async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    return buildReport(prisma, days);
  });

  app.get('/api/admin/overview', { preHandler: requireAdmin('overview', 'view') }, async () => {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [
      brandsByStatus,
      ordersToday,
      ordersByStatus,
      blockedOrders,
      capturedAgg,
      floatRow,
      activeSubs,
      brandCount,
      publishedCatalog,
      webhookByStatus,
      recentActivity,
    ] = await Promise.all([
      prisma.brand.groupBy({ by: ['status'], _count: true }),
      prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.order.groupBy({ by: ['status'], _count: true }),
      prisma.order.count({ where: { blocker: { not: 'none' } } }),
      prisma.walletLedger.aggregate({ where: { type: 'capture' }, _sum: { amount: true } }),
      prisma.$queryRaw<{ float: bigint | null }[]>`
        SELECT COALESCE(SUM(bal), 0)::bigint AS float FROM (
          SELECT DISTINCT ON (brand_id) balance_after AS bal
          FROM wallet_ledger ORDER BY brand_id, seq DESC
        ) t`,
      prisma.subscriptionState.groupBy({ by: ['plan'], where: { status: 'active' }, _count: true }),
      prisma.brand.count(),
      prisma.catalogProduct.count({ where: { isPublished: true } }),
      prisma.webhookEvent.groupBy({ by: ['status'], _count: true }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);

    const toMap = (rows: { _count: number }[], field: string): Record<string, number> => {
      const m: Record<string, number> = {};
      for (const r of rows) m[String((r as Record<string, unknown>)[field])] = r._count;
      return m;
    };

    const brands = toMap(brandsByStatus, 'status');
    const orders = toMap(ordersByStatus, 'status');
    const subs = toMap(activeSubs, 'plan');
    const webhooks = toMap(webhookByStatus, 'status');

    const proVolume = (subs.pro ?? 0) + (subs.volume ?? 0);

    return {
      brands: {
        total: brandCount,
        active: brands.active ?? 0,
        suspended: brands.suspended ?? 0,
      },
      orders: {
        today: ordersToday,
        ready: orders.ready_for_fulfillment ?? 0,
        shipped: orders.shipped ?? 0,
        delivered: orders.delivered ?? 0,
        action_required: blockedOrders,
      },
      money: {
        captured_gmv_cents: Math.abs(capturedAgg._sum.amount ?? 0),
        wallet_float_cents: Number(floatRow[0]?.float ?? 0),
      },
      plans: {
        starter: brandCount - proVolume, // brands without an active paid sub
        pro: subs.pro ?? 0,
        volume: subs.volume ?? 0,
      },
      catalog: { published: publishedCatalog },
      webhooks: { processed: webhooks.processed ?? 0, failed: webhooks.failed ?? 0, received: webhooks.received ?? 0 },
      recent_activity: recentActivity.map((a) => ({
        id: a.id,
        actor_type: a.actorType,
        action: a.action,
        target_type: a.targetType,
        created_at: a.createdAt,
      })),
    };
  });
}
