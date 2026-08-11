import type { FastifyInstance } from 'fastify';
import { Prisma } from '@ruostack/db';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { remapStoreOrder } from '../services/store-remap.ts';
import { Conflict, NotFound } from '../errors.ts';

/**
 * Store-Match: SKU aliases + No-Match exception resolution (§3). A store order
 * line whose SKU matches neither a canonical SKU nor an alias becomes a No-Match
 * (order blocker needs_mapping). An operator creates the alias here, which
 * auto-releases every blocked order containing that SKU. Role-gated on
 * 'exceptions'.
 */
export async function adminAliasRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // No-Match exception queue: blocked store orders + their unmatched SKUs.
  app.get('/api/admin/no-match', { preHandler: requireAdmin('exceptions', 'view') }, async () => {
    const orders = await prisma.order.findMany({
      where: { source: 'woocommerce', blocker: 'needs_mapping' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { brand: { select: { id: true, brandName: true } } },
    });
    return {
      orders: orders.map((o) => ({
        id: o.id,
        brand_id: o.brand.id,
        brand_name: o.brand.brandName,
        external_order_id: o.externalOrderId,
        recipient: { name: o.recipientName, city: o.city, state: o.state },
        unmatched_skus: o.unmatchedSkus,
        created_at: o.createdAt,
      })),
    };
  });

  // Aliases for a brand.
  app.get('/api/admin/aliases', { preHandler: requireAdmin('exceptions', 'view') }, async (req) => {
    const { brand_id } = z.object({ brand_id: z.string().uuid().optional() }).parse(req.query);
    const aliases = await prisma.productAlias.findMany({
      where: { ...(brand_id ? { brandId: brand_id } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { product: { select: { canonicalSku: true, name: true } }, brand: { select: { brandName: true } } },
    });
    return {
      aliases: aliases.map((a) => ({
        id: a.id,
        brand_id: a.brandId,
        brand_name: a.brand.brandName,
        woo_sku: a.wooSku,
        product_id: a.productId,
        canonical_sku: a.product.canonicalSku,
        product_name: a.product.name,
        created_at: a.createdAt,
      })),
    };
  });

  // Create an alias → auto-release matching No-Match orders.
  app.post('/api/admin/aliases', { preHandler: requireAdmin('exceptions', 'write') }, async (req) => {
    const b = z.object({ brand_id: z.string().uuid(), woo_sku: z.string().min(1).max(60), product_id: z.string().uuid() }).parse(req.body);
    const wooSku = b.woo_sku.trim();
    if (!(await prisma.catalogProduct.findUnique({ where: { id: b.product_id } }))) throw NotFound('Product not found');

    let alias;
    try {
      alias = await prisma.productAlias.create({ data: { brandId: b.brand_id, wooSku, productId: b.product_id, createdBy: req.admin!.adminUserId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Conflict('alias_exists', `SKU '${wooSku}' is already mapped for this brand`);
      throw e;
    }
    await writeAudit(prisma, { actorType: 'admin', actorId: req.admin!.adminUserId, action: AUDIT_ACTIONS.storeAliasCreated, targetType: 'product_alias', targetId: alias.id, after: { brand_id: b.brand_id, woo_sku: wooSku, product_id: b.product_id }, ip: req.ip });

    // Release every blocked order for this brand whose No-Match set includes the SKU.
    const blocked = await prisma.order.findMany({ where: { brandId: b.brand_id, blocker: 'needs_mapping', unmatchedSkus: { has: wooSku } }, select: { id: true } });
    let released = 0;
    for (const o of blocked) {
      const r = await remapStoreOrder(prisma, o.id, req.admin!.adminUserId, req.ip);
      if (r.resolved) released++;
    }
    return { alias: { id: alias.id, woo_sku: wooSku }, matched_orders: blocked.length, released };
  });

  app.delete('/api/admin/aliases/:id', { preHandler: requireAdmin('exceptions', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await prisma.productAlias.findUnique({ where: { id } }))) throw NotFound('Alias not found');
    await prisma.productAlias.delete({ where: { id } });
    await writeAudit(prisma, { actorType: 'admin', actorId: req.admin!.adminUserId, action: AUDIT_ACTIONS.storeAliasDeleted, targetType: 'product_alias', targetId: id, ip: req.ip });
    return { ok: true };
  });

  // Manually re-map an order against the current alias table.
  app.post('/api/admin/orders/:id/remap', { preHandler: requireAdmin('exceptions', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return remapStoreOrder(prisma, id, req.admin!.adminUserId, req.ip);
  });
}
