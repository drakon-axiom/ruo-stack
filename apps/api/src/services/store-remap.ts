import type { OrderBlocker, PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS } from '@ruostack/shared';
import { writeAudit } from '../audit.ts';
import { applyOrderEdit } from './order-edit.ts';
import { resolveSkus } from './sku-resolver.ts';
import { BadRequest, NotFound } from '../errors.ts';

interface SourceItem {
  sku: string;
  qty: number;
}

/**
 * Re-map a store order against the current alias table (No-Match resolution, §3).
 * Resolves the order's stored source line items by canonical SKU + alias; rebuilds
 * the line items + re-prices/re-boxes/re-reserves via the shared edit path; sets
 * the final blocker — needs_mapping if any SKU is STILL unresolved, else the
 * funds-based blocker from re-pricing. Idempotent + safe to call repeatedly.
 */
export async function remapStoreOrder(
  prisma: PrismaClient,
  orderId: string,
  adminId: string,
  ip?: string | null,
): Promise<{ resolved: boolean; matched: number; unmatched: string[] }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw NotFound('Order not found');
  if (order.status === 'shipped' || order.status === 'delivered' || order.status === 'cancelled') {
    throw BadRequest('not_remappable', 'Only a pre-ship order can be re-mapped');
  }

  const source = (order.sourceItems as unknown as SourceItem[] | null) ?? [];
  const resolved = await resolveSkus(prisma, order.brandId, source.map((i) => i.sku));

  const qtyByProduct = new Map<string, number>();
  const unmatched: string[] = [];
  for (const it of source) {
    const p = resolved.get(it.sku) ?? null;
    if (!p) unmatched.push(it.sku);
    else qtyByProduct.set(p.id, (qtyByProduct.get(p.id) ?? 0) + it.qty);
  }
  const items = [...qtyByProduct.entries()].map(([product_id, qty]) => ({ product_id, qty }));

  // Re-price + re-box + re-reserve the resolved items (when any resolved).
  if (items.length > 0) await applyOrderEdit(prisma, order, { items }, { type: 'admin', id: adminId, ip });

  await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({ where: { id: orderId }, select: { blocker: true } });
    // Still-unresolved SKUs keep the order blocked; otherwise keep the funds-based
    // blocker that re-pricing set (none / awaiting_funds).
    const blocker: OrderBlocker = unmatched.length > 0 ? 'needs_mapping' : (current?.blocker ?? 'none');
    await tx.order.update({ where: { id: orderId }, data: { unmatchedSkus: unmatched, blocker } });
    await writeAudit(tx, {
      actorType: 'admin',
      actorId: adminId,
      action: AUDIT_ACTIONS.storeOrderRemapped,
      targetType: 'order',
      targetId: orderId,
      after: { matched: items.length, unmatched: unmatched.length, blocker },
      ip: ip ?? null,
    });
  });

  return { resolved: unmatched.length === 0, matched: items.length, unmatched };
}
