import type { PrismaClient } from '@ruostack/db';

/**
 * Reporting (Phase 3): the analytical metrics the plan names — shipping margin
 * (label-cost vs charge), fallback rate, and claims/SLA economics — over a
 * rolling window. Computed live from the DB; complements the Overview snapshot.
 */
function toMap(rows: { _count: number }[], field: string): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) m[String((r as Record<string, unknown>)[field])] = r._count;
  return m;
}

export async function buildReport(prisma: PrismaClient, days: number) {
  const from = new Date(Date.now() - days * 86_400_000);
  const now = new Date();

  const [shipAgg, labeledCount, ordersTotal, ordersBySource, rateRows, capturedAgg, subsByPlan, subsByStatus, claimsOpened, claimsByStatus, claimsByResolution, creditsAgg, overdueClaims] = await Promise.all([
    prisma.order.aggregate({ where: { status: { in: ['shipped', 'delivered'] }, shippedAt: { gte: from } }, _sum: { shippingTotalCents: true, labelCostCents: true, wholesaleTotalCents: true }, _count: true }),
    prisma.order.count({ where: { status: { in: ['shipped', 'delivered'] }, shippedAt: { gte: from }, labelCostCents: { not: null } } }),
    prisma.order.count({ where: { createdAt: { gte: from } } }),
    prisma.order.groupBy({ by: ['source'], where: { createdAt: { gte: from } }, _count: true }),
    prisma.order.groupBy({ by: ['rateSource'], where: { createdAt: { gte: from }, rateSource: { not: null } }, _count: true }),
    prisma.walletLedger.aggregate({ where: { type: 'capture', createdAt: { gte: from } }, _sum: { amount: true } }),
    prisma.subscriptionState.groupBy({ by: ['plan'], where: { status: 'active' }, _count: true }),
    prisma.subscriptionState.groupBy({ by: ['status'], _count: true }),
    prisma.claim.count({ where: { createdAt: { gte: from } } }),
    prisma.claim.groupBy({ by: ['status'], _count: true }),
    prisma.claim.groupBy({ by: ['resolution'], where: { resolution: { not: null } }, _count: true }),
    prisma.walletLedger.aggregate({ where: { type: 'refund_credit', createdAt: { gte: from } }, _sum: { amount: true } }),
    prisma.claim.count({ where: { status: { not: 'resolved' }, slaDueAt: { lt: now } } }),
  ]);

  const charged = shipAgg._sum.shippingTotalCents ?? 0;
  const labelCost = shipAgg._sum.labelCostCents ?? 0;
  const rateMap = toMap(rateRows, 'rateSource');
  const ratePriced = Object.values(rateMap).reduce((a, b) => a + b, 0);
  const fallbackCount = (rateMap.flat ?? 0) + (rateMap.fallback ?? 0);

  return {
    period: { days, from: from.toISOString() },
    shipping: {
      shipments: shipAgg._count,
      charged_cents: charged, // what brands' wallets paid for shipping (carrier + pick-&-pack)
      label_cost_cents: labelCost, // actual carrier label cost reported by ShipStation
      margin_cents: charged - labelCost,
      labeled_count: labeledCount,
      unlabeled_count: shipAgg._count - labeledCount, // manual marks / no reported label cost
    },
    fallback: {
      priced: ratePriced,
      fallback: fallbackCount,
      share: ratePriced ? fallbackCount / ratePriced : 0,
      by_source: rateMap,
    },
    orders: { total: ordersTotal, by_source: toMap(ordersBySource, 'source') },
    money: { captured_cents: Math.abs(capturedAgg._sum.amount ?? 0), wholesale_cents: shipAgg._sum.wholesaleTotalCents ?? 0 },
    subscriptions: { active_by_plan: toMap(subsByPlan, 'plan'), by_status: toMap(subsByStatus, 'status') },
    claims: {
      opened: claimsOpened,
      by_status: toMap(claimsByStatus, 'status'),
      by_resolution: toMap(claimsByResolution, 'resolution'),
      credits_cents: creditsAgg._sum.amount ?? 0,
      sla_overdue: overdueClaims,
    },
  };
}
