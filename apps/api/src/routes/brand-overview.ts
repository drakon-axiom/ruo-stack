import type { FastifyInstance } from 'fastify';
import { getClients } from '../clients.js';
import { requireBrand } from '../middleware/guards.js';
import { effectivePlan } from '../services/subscription.js';
import { getWalletSummary } from '../services/wallet.js';

/**
 * Brand Overview — the portal home dashboard. Aggregates the brand's own orders +
 * wallet + onboarding checklist, plus a referral summary. Every query is scoped to
 * req.brand!.brandId (never cross-brand). Mirrors admin-overview.ts (toMap fold,
 * Promise.all). No new data model — reads existing tables.
 */
export async function brandOverviewRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  const toMap = (rows: { _count: number }[], field: string): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const r of rows) m[String((r as Record<string, unknown>)[field])] = r._count;
    return m;
  };

  // ── Dashboard ──────────────────────────────────────────────────────────────
  app.get('/api/brand/overview', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [
      ordersToday,
      ordersByStatus,
      blockedOrders,
      orderTotal,
      recent,
      sub,
      wallet,
      storeConn,
      retailCount,
    ] = await Promise.all([
      prisma.order.count({ where: { brandId, createdAt: { gte: startOfToday } } }),
      prisma.order.groupBy({ by: ['status'], where: { brandId }, _count: true }),
      prisma.order.count({ where: { brandId, blocker: { not: 'none' } } }),
      prisma.order.count({ where: { brandId } }),
      prisma.order.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.subscriptionState.findUnique({ where: { brandId }, select: { plan: true, status: true } }),
      getWalletSummary(prisma, brandId),
      prisma.brandStoreConnection.findFirst({ where: { brandId } }),
      prisma.brandProductPrice.count({ where: { brandId } }),
    ]);

    const orders = toMap(ordersByStatus, 'status');
    const plan = effectivePlan(sub);

    return {
      orders: {
        today: ordersToday,
        ready: orders.ready_for_fulfillment ?? 0,
        shipped: orders.shipped ?? 0,
        delivered: orders.delivered ?? 0,
        total: orderTotal,
        action_required: blockedOrders,
      },
      wallet: {
        available_cents: wallet.available,
        balance_cents: wallet.balance,
        held_cents: wallet.held,
      },
      plan,
      checklist: {
        store_connected: !!storeConn,
        wallet_funded: wallet.balance > 0,
        retail_set: retailCount > 0,
        first_order: orderTotal > 0,
      },
      recent_orders: recent.map((o) => ({
        id: o.id,
        recipient: { name: o.recipientName, city: o.city, state: o.state },
        wallet_charge_cents: o.walletChargeCents,
        status: o.status,
        blocker: o.blocker,
        exported_at: o.exportedAt,
        tracking_number: o.trackingNumber,
        created_at: o.createdAt,
      })),
    };
  });

  // ── Referrals ──────────────────────────────────────────────────────────────
  app.get('/api/brand/referrals', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const me = await prisma.brand.findUnique({ where: { id: brandId }, select: { referralCode: true } });
    const code = me?.referralCode ?? '';

    // Brands this brand referred (stored as referredBy = our code on signup).
    const referred = await prisma.brand.findMany({ where: { referredBy: code }, select: { id: true } });
    const ids = referred.map((b) => b.id);

    const [upgraded, earnedAgg] = await Promise.all([
      ids.length
        ? prisma.subscriptionState.count({ where: { brandId: { in: ids }, status: 'active', plan: { not: 'starter' } } })
        : Promise.resolve(0),
      prisma.walletLedger.aggregate({ where: { brandId, type: 'referral_credit' }, _sum: { amount: true } }),
    ]);

    return {
      code,
      invited: ids.length,
      upgraded,
      earned_cents: Math.abs(earnedAgg._sum.amount ?? 0),
    };
  });
}
